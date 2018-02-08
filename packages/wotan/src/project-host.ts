import * as ts from 'typescript';
import { resolveCachedResult, hasSupportedExtension } from './utils';
import * as path from 'path';
import { ProcessorLoader } from './services/processor-loader';
import { FileKind, CachedFileSystem } from './services/cached-file-system';
import { Configuration, AbstractProcessor } from './types';
import { bind } from 'bind-decorator';
import { ConfigurationManager } from './services/configuration-manager';

// @internal
export interface ProcessedFileInfo {
    originalName: string;
    originalContent: string;
    processor: AbstractProcessor;
}

// @internal
export class ProjectHost implements ts.CompilerHost {
    private reverseMap = new Map<string, string>();
    private files = new Set<string>();
    private directoryEntries = new Map<string, ts.FileSystemEntries>();
    private processedFiles = new Map<string, ProcessedFileInfo>();
    private sourceFileCache = new Map<string, ts.SourceFile | undefined>();
    private fileContent = new Map<string, string>();

    constructor(
        public cwd: string,
        public config: Configuration | undefined,
        private fs: CachedFileSystem,
        private configManager: ConfigurationManager,
        private processorLoader: ProcessorLoader,
    ) {}

    public getProcessedFileInfo(fileName: string) {
        return this.processedFiles.get(fileName);
    }
    public getDirectoryEntries(dir: string): ts.FileSystemEntries {
        return resolveCachedResult(this.directoryEntries, dir, this.processDirectory);
    }
    @bind
    private processDirectory(dir: string): ts.FileSystemEntries {
        const files: string[] = [];
        const directories: string[] = [];
        const result: ts.FileSystemEntries = {files, directories};
        let entries: string[];
        try {
            entries = this.fs.readDirectory(dir);
        } catch {
            return result;
        }
        let c: Configuration | undefined | 'initial' = this.config || 'initial';
        for (const entry of entries) {
            const fileName = `${dir}/${entry}`;
            switch (this.fs.getKind(fileName)) {
                case FileKind.File: {
                    if (!hasSupportedExtension(fileName)) {
                        if (c === 'initial')
                            c = this.configManager.find(fileName);
                        const processor = c && this.configManager.getProcessor(c, fileName);
                        if (processor) {
                            const ctor = this.processorLoader.loadProcessor(processor);
                            const newName = fileName +
                                ctor.getSuffixForFile(
                                    fileName,
                                    this.configManager.getSettings(c!, fileName),
                                    () => this.fs.readFile(fileName),
                                );
                            if (hasSupportedExtension(newName)) {
                                files.push(newName);
                                this.reverseMap.set(newName, fileName);
                                break;
                            }
                        }
                    }
                    files.push(fileName);
                    this.files.add(fileName);
                    break;
                }
                case FileKind.Directory:
                    directories.push(fileName);
            }
        }
        return result;
    }

    public fileExists(file: string): boolean {
        switch (this.fs.getKind(file)) {
            case FileKind.Directory:
            case FileKind.Other:
                return false;
            case FileKind.File:
                return true;
            default:
                return hasSupportedExtension(file) && this.getFileSystemFile(file) !== undefined;
        }
    }

    public directoryExists(dir: string) {
        return this.fs.isDirectory(dir);
    }

    public getFileSystemFile(file: string): string | undefined {
        if (this.files.has(file))
            return file;
        const reverse = this.reverseMap.get(file);
        if (reverse !== undefined)
            return reverse;
        const dirname = path.posix.dirname(file);
        if (this.directoryEntries.has(dirname))
            return;
        if (this.fs.isFile(file))
            return file;
        this.directoryEntries.set(dirname, this.processDirectory(dirname));
        return this.getFileSystemFile(file);
    }

    public readFile(file: string) {
        return resolveCachedResult(this.fileContent, file, (f) => this.fs.readFile(f));
    }

    private readProcessedFile(file: string): string {
        const realFile = this.getFileSystemFile(file)!;
        let content = this.fs.readFile(realFile);
        const config = this.config || this.configManager.find(realFile);
        if (config === undefined)
            return content;
        const processorPath = this.configManager.getProcessor(config, realFile);
        if (processorPath === undefined)
            return content;
        const ctor = this.processorLoader.loadProcessor(processorPath);
        const processor = new ctor(content, realFile, file, this.configManager.getSettings(config, realFile));
        this.processedFiles.set(file, {
            processor,
            originalContent: content,
            originalName: realFile,
        });
        content = processor.preprocess();
        return content;
    }

    public writeFile() {}
    public useCaseSensitiveFileNames() {
        return ts.sys.useCaseSensitiveFileNames;
    }
    public getDefaultLibFileName = ts.getDefaultLibFilePath;
    public getCanonicalFileName = ts.sys.useCaseSensitiveFileNames ? (f: string) => f : (f: string) => f.toLowerCase();
    public getNewLine() {
        return '\n';
    }
    public realpath = this.fs.realpath === undefined ? undefined : (fileName: string) => this.fs.realpath!(fileName);
    public getCurrentDirectory() {
        return this.cwd;
    }
    public getDirectories(dir: string) {
        const cached = this.directoryEntries.get(dir);
        if (cached !== undefined)
            return cached.directories.map((d) => path.posix.basename(d));
        return this.fs.readDirectory(dir).filter((f) => this.fs.isDirectory(path.join(dir, f)));
    }
    public getSourceFile(fileName: string, languageVersion: ts.ScriptTarget) {
        return resolveCachedResult(
            this.sourceFileCache,
            fileName,
            () => ts.createSourceFile(fileName, this.readProcessedFile(fileName), languageVersion, true),
        );
    }

    public updateSourceFile(
        sourceFile: ts.SourceFile,
        program: ts.Program,
        newContent: string,
        changeRange: ts.TextChangeRange,
    ): {sourceFile: ts.SourceFile, program: ts.Program} {
        sourceFile = ts.updateSourceFile(sourceFile, newContent, changeRange);
        this.sourceFileCache.set(sourceFile.fileName, sourceFile);
        program = ts.createProgram(program.getRootFileNames(), program.getCompilerOptions(), this, program);
        return {sourceFile, program};
    }
}
