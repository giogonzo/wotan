import * as ts from 'typescript';
import {
    Finding,
    EffectiveConfiguration,
    LintAndFixFileResult,
    Replacement,
    RuleContext,
    Severity,
    RuleConstructor,
    MessageHandler,
    AbstractProcessor,
    DeprecationHandler,
    DeprecationTarget,
    FindingFilterFactory,
    FindingFilter,
} from '@fimbul/ymir';
import { applyFixes } from './fix';
import * as debug from 'debug';
import { injectable } from 'inversify';
import { RuleLoader } from './services/rule-loader';
import { calculateChangeRange, invertChangeRange } from './utils';
import { ConvertedAst, convertAst, isCompilerOptionEnabled, getCheckJsDirective } from 'tsutils';

const log = debug('wotan:linter');

export interface LinterOptions {
    reportUselessDirectives?: Severity;
}

/** This factory is used to lazily create or update the Program only when necessary. */
export interface ProgramFactory {
    /** Get the CompilerOptions used to create the Program. */
    getCompilerOptions(): ts.CompilerOptions;
    /** This method is called to retrieve the Program on the first use. It should create or update the Program if necessary. */
    getProgram(): ts.Program;
}

class StaticProgramFactory implements ProgramFactory {
    constructor(private program: ts.Program) {}

    public getCompilerOptions() {
        return this.program.getCompilerOptions();
    }

    public getProgram() {
        return this.program;
    }
}

class CachedProgramFactory implements ProgramFactory {
    private program: ts.Program | undefined = undefined;
    private options: ts.CompilerOptions | undefined = undefined;

    constructor(private factory: ProgramFactory) {}

    public getCompilerOptions() {
        return this.options || (this.options = this.factory.getCompilerOptions());
    }

    public getProgram() {
        if (this.program === undefined) {
            this.program = this.factory.getProgram();
            this.options = this.program.getCompilerOptions();
        }
        return this.program;
    }
}

/**
 * Creates a new SourceFile from the updated source.
 *
 * @returns the new `SourceFile` on success or `undefined` to roll back the latest set of changes.
 */
export type UpdateFileCallback = (content: string, range: ts.TextChangeRange) => ts.SourceFile | undefined;

@injectable()
export class Linter {
    constructor(
        private ruleLoader: RuleLoader,
        private logger: MessageHandler,
        private deprecationHandler: DeprecationHandler,
        private filterFactory: FindingFilterFactory,
    ) {}

    public lintFile(
        file: ts.SourceFile,
        config: EffectiveConfiguration,
        programOrFactory?: ProgramFactory | ts.Program,
        options: LinterOptions = {},
    ): ReadonlyArray<Finding> {
        return this.getFindings(
            file,
            config,
            programOrFactory !== undefined && 'getTypeChecker' in programOrFactory
                ? new StaticProgramFactory(programOrFactory)
                : programOrFactory,
            undefined,
            options,
        );
    }

    public lintAndFix(
        file: ts.SourceFile,
        content: string,
        config: EffectiveConfiguration,
        updateFile: UpdateFileCallback,
        iterations: number = 10,
        programFactory?: ProgramFactory,
        processor?: AbstractProcessor,
        options: LinterOptions = {},
    ): LintAndFixFileResult {
        let totalFixes = 0;
        let findings = this.getFindings(file, config, programFactory, processor, options);
        for (let i = 0; i < iterations; ++i) {
            if (findings.length === 0)
                break;
            const fixes = findings.map((f) => f.fix).filter(<T>(f: T | undefined): f is T => f !== undefined);
            if (fixes.length === 0) {
                log('No fixes');
                break;
            }
            log('Trying to apply %d fixes in %d. iteration', fixes.length, i + 1);
            const fixed = applyFixes(content, fixes);
            log('Applied %d fixes', fixed.fixed);
            let newSource: string;
            let fixedRange: ts.TextChangeRange;
            if (processor !== undefined) {
                const {transformed, changeRange} = processor.updateSource(fixed.result, fixed.range);
                fixedRange = changeRange !== undefined ? changeRange : calculateChangeRange(file.text, transformed);
                newSource = transformed;
            } else {
                newSource = fixed.result;
                fixedRange = fixed.range;
            }
            const updateResult = updateFile(newSource, fixedRange);
            if (updateResult === undefined) {
                log('Rolling back latest fixes and abort linting');
                if (processor !== undefined) // reset processor state
                    processor.updateSource(content, invertChangeRange(fixed.range));
                break;
            }
            file = updateResult;
            content = fixed.result;
            totalFixes += fixed.fixed;
            findings = this.getFindings(file, config, programFactory, processor, options);
        }
        return {
            content,
            findings,
            fixes: totalFixes,
        };
    }

    // @internal
    public getFindings(
        sourceFile: ts.SourceFile,
        config: EffectiveConfiguration,
        programFactory: ProgramFactory | undefined,
        processor: AbstractProcessor | undefined,
        options: LinterOptions,
    ) {
        if (programFactory !== undefined)
            // make sure that all rules get the same Program and CompilerOptions for this run
            programFactory = new CachedProgramFactory(programFactory);

        let suppressMissingTypeInfoWarning = false;
        log('Linting file %s', sourceFile.fileName);
        if (programFactory !== undefined && /\.jsx?/.test(sourceFile.fileName)) {
            const directive = getCheckJsDirective(sourceFile.text);
            if (directive === undefined ? !isCompilerOptionEnabled(programFactory.getCompilerOptions(), 'checkJs') : !directive.enabled) {
                log('Not using type information for this unchecked JS file');
                programFactory = undefined;
                suppressMissingTypeInfoWarning = true;
            }
        }
        const rules = this.prepareRules(config, sourceFile, programFactory, suppressMissingTypeInfoWarning);
        let findings;
        if (rules.length === 0) {
            log('No active rules');
            if (options.reportUselessDirectives !== undefined) {
                findings = this.filterFactory
                    .create({sourceFile, getWrappedAst() { return convertAst(sourceFile).wrapped; }, ruleNames: []})
                    .reportUseless(options.reportUselessDirectives);
                log('Found %d useless directives', findings.length);
            } else {
                findings = [];
            }
        }
        findings = this.applyRules(sourceFile, programFactory, rules, config.settings, options);
        return processor === undefined ? findings : processor.postprocess(findings);
    }

    private prepareRules(
        config: EffectiveConfiguration,
        sourceFile: ts.SourceFile,
        programFactory: ProgramFactory | undefined,
        noWarn: boolean,
    ) {
        const rules: PreparedRule[] = [];
        for (const [ruleName, {options, severity, rulesDirectories, rule}] of config.rules) {
            if (severity === 'off')
                continue;
            const ctor = this.ruleLoader.loadRule(rule, rulesDirectories);
            if (ctor === undefined)
                continue;
            if (ctor.deprecated)
                this.deprecationHandler.handle(
                    DeprecationTarget.Rule,
                    ruleName,
                    typeof ctor.deprecated === 'string' ? ctor.deprecated : undefined,
                );
            if (programFactory === undefined && ctor.requiresTypeInformation) {
                if (noWarn) {
                    log('Rule %s requires type information', ruleName);
                } else {
                    this.logger.warn(`Rule '${ruleName}' requires type information.`);
                }
                continue;
            }
            if (ctor.supports !== undefined) {
                const supports = ctor.supports(sourceFile, {
                    get program() { return programFactory && programFactory.getProgram(); },
                    get compilerOptions() { return programFactory && programFactory.getCompilerOptions(); },
                    options,
                    settings: config.settings,
                });
                if (supports !== true) {
                    if (!supports) {
                        log(`Rule %s does not support this file`, ruleName);
                    } else {
                        log(`Rule %s does not support this file: %s`, ruleName, supports);
                    }
                    continue;
                }
            }
            rules.push({ruleName, options, severity, ctor});
        }
        return rules;
    }

    private applyRules(
        sourceFile: ts.SourceFile,
        programFactory: ProgramFactory | undefined,
        rules: PreparedRule[],
        settings: Map<string, any>,
        options: LinterOptions,
    ) {
        const result: Finding[] = [];
        let findingFilter: FindingFilter | undefined;
        let ruleName: string;
        let severity: Severity;
        let ctor: RuleConstructor;
        let convertedAst: ConvertedAst | undefined;

        const getFindingFilter = () => {
            return findingFilter ||
                (findingFilter = this.filterFactory.create({sourceFile, getWrappedAst, ruleNames: rules.map((r) => r.ruleName)}));
        };
        const addFinding = (pos: number, end: number, message: string, fix?: Replacement | ReadonlyArray<Replacement>) => {
            const finding: Finding = {
                ruleName,
                severity,
                message,
                start: {
                    position: pos,
                    ...ts.getLineAndCharacterOfPosition(sourceFile, pos),
                },
                end: {
                    position: end,
                    ...ts.getLineAndCharacterOfPosition(sourceFile, end),
                },
                fix: fix === undefined
                    ? undefined
                    : !Array.isArray(fix)
                        ? {replacements: [fix]}
                        : fix.length === 0
                            ? undefined
                            : {replacements: fix},
            };
            if (getFindingFilter().filter(finding))
                result.push(finding);
        };

        const context: { -readonly [K in keyof RuleContext]: RuleContext[K] } = {
            addFinding,
            getFlatAst,
            getWrappedAst,
            get program() { return programFactory && programFactory.getProgram(); },
            get compilerOptions() { return programFactory && programFactory.getCompilerOptions(); },
            sourceFile,
            settings,
            options: undefined,
        };

        for ({ruleName, severity, ctor, options: context.options} of rules) {
            log('Executing rule %s', ruleName);
            new ctor(context).apply();
        }

        log('Found %d findings', result.length);
        if (options.reportUselessDirectives !== undefined) {
            const useless = getFindingFilter().reportUseless(options.reportUselessDirectives);
            log('Found %d useless directives', useless.length);
            result.push(...useless);
        }
        return result;

        function getFlatAst() {
            return (convertedAst || (convertedAst = convertAst(sourceFile))).flat;
        }
        function getWrappedAst() {
            return (convertedAst || (convertedAst = convertAst(sourceFile))).wrapped;
        }
    }
}

interface PreparedRule {
    ctor: RuleConstructor;
    options: any;
    ruleName: string;
    severity: Severity;
}
