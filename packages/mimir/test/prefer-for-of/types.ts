export {};

declare let array: Array<any>;

for (let i = 0; i < array.length; ++i) {
    array[i]
}

declare let readonlyArray: ReadonlyArray<any>;

for (let i = 0; i < readonlyArray.length; ++i) {
    readonlyArray[i]
}

interface MyArray<T = any> extends Array<T> {
    prop: T;
}
declare let myArray: MyArray;

for (let i = 0; i < myArray.length; ++i) {
    myArray[i]
}

declare let myArray2: MyArray<string>;

for (let i = 0; i < myArray2.length; ++i) {
    myArray2[i]
}

interface ArrayLike {
    [index: number]: number;
    length: number;
}

declare let arrayLike: ArrayLike;

for (let i = 0; i < arrayLike.length; ++i) {
    arrayLike[i]
}

declare let typedArray: Uint16Array;

for (let i = 0; i < typedArray.length; ++i) {
    typedArray[i]
}

declare let anyValue: any;

for (let i = 0; i < anyValue.length; ++i) {
    anyValue[i]
}

function test<T extends any[], U, V extends any>(param: T, param2: U, param3: V) {
    for (let i = 0; i < param.length; ++i) {
        param[i]
    }

    let v: T | ReadonlyArray<string> = [];
    for (let i = 0; i < v.length; ++i) {
        v[i]
    }

    for (let i = 0; i < param2.length; ++i) {
        param2[i]
    }

    for (let i = 0; i < param3.length; ++i) {
        param3[i]
    }
}

for (let i = 0; i < "foo".length; ++i) {
    "foo"[i]
}

declare let arrayUnion: Array<any> | ArrayLike;

for (let i = 0; i < arrayUnion.length; ++i) {
    arrayUnion[i]
}

{
    interface Array<T> {
        [index: number]: T;
        length: number;
    }
    let shadowedArray: Array<any> = [];
    for (let i = 0; i < shadowedArray.length; ++i) {
        shadowedArray[i]
    }
}

declare let iterable: ArrayLike & IterableIterator<number>;
for (let i = 0; i < iterable.length; ++i) {
    iterable[i]
}

declare let optionallyIterable: ArrayLike & {[Symbol.iterator]?(): Iterator<number>};
for (let i = 0; i < optionallyIterable.length; ++i) {
    optionallyIterable[i]
}

declare let iterableWithParameter: ArrayLike & {[Symbol.iterator](param: string): Iterator<number>};
for (let i = 0; i < iterableWithParameter.length; ++i) {
    iterableWithParameter[i]
}

declare let iterableWithOptionalParameter: ArrayLike & {[Symbol.iterator](param?: string): Iterator<number>};
for (let i = 0; i < iterableWithOptionalParameter.length; ++i) {
    iterableWithOptionalParameter[i]
}

declare let iterableWithRestParameter: ArrayLike & {[Symbol.iterator](...params: string[]): Iterator<number>};
for (let i = 0; i < iterableWithRestParameter.length; ++i) {
    iterableWithRestParameter[i]
}

declare let iterableWithMultipleSignatures: ArrayLike & {[Symbol.iterator](param: string): Iterator<number>, [Symbol.iterator](): Iterator<number>};
for (let i = 0; i < iterableWithMultipleSignatures.length; ++i) {
    iterableWithMultipleSignatures[i]
}

declare let iterableWithWrongSignature: ArrayLike & {[Symbol.iterator](param: string): {}, [Symbol.iterator](): Iterator<number>};
for (let i = 0; i < iterableWithWrongSignature.length; ++i) {
    iterableWithWrongSignature[i]
}

declare let iteratorWithoutNext: ArrayLike & {[Symbol.iterator](): {}};
for (let i = 0; i < iteratorWithoutNext.length; ++i) {
    iteratorWithoutNext[i]
}

declare let iteratorWithNextProperty: ArrayLike & {[Symbol.iterator](): {next: any}};
for (let i = 0; i < iteratorWithNextProperty.length; ++i) {
    iteratorWithNextProperty[i]
}

declare let iteratorWithNextParameter: ArrayLike & {[Symbol.iterator](): {next: (param: string) => IteratorResult<number>}};
for (let i = 0; i < iteratorWithNextParameter.length; ++i) {
    iteratorWithNextParameter[i]
}

declare let iteratorResultWithOptionalDone: ArrayLike & {[Symbol.iterator](): {next(): {done?: boolean, value: number}}};
for (let i = 0; i < iteratorResultWithOptionalDone.length; ++i) {
    iteratorResultWithOptionalDone[i]
}

declare let iteratorResultWithMistypedDone: ArrayLike & {[Symbol.iterator](): {next(): {done: string, value: number}}};
for (let i = 0; i < iteratorResultWithMistypedDone.length; ++i) {
    iteratorResultWithMistypedDone[i]
}

declare let iteratorResultWithoutValue: ArrayLike & {[Symbol.iterator](): {next(): {done: boolean}}};
for (let i = 0; i < iteratorResultWithoutValue.length; ++i) {
    iteratorResultWithoutValue[i]
}

class MyIterable {
    [key: number]: number;
    length = 0;
    [Symbol.iterator](param = undefined) {
        return {
            next(done = false, ...rest: any[]) {
                return {value: 1, done};
            },
        }
    }
}
let myIterable = new MyIterable();
for (let i = 0; i < myIterable.length; ++i) {
    myIterable[i]
}

declare let noIndexSignature: {length: number, [Symbol.iterator](): IterableIterator<number>};
for (let i = 0; i < noIndexSignature.length; ++i) {
     noIndexSignature[i]
}

declare let stringIndexSignature: {[key: string]: number, length: number, [Symbol.iterator](): IterableIterator<number>};
for (let i = 0; i < stringIndexSignature.length; ++i) {
     stringIndexSignature[i]
}

declare let iterableWithDifferentType: ArrayLike & Iterable<string>;
for (let i = 0; i < iterableWithDifferentType.length; ++i) {
    iterableWithDifferentType[i]
}

import {jsIterable, jsNotIterable} from './jsdoc';

for (let i = 0; i < jsIterable.length; ++i) {
    jsIterable[i]
}

for (let i = 0; i < jsNotIterable.length; ++i) {
    jsNotIterable[i]
}

declare class PrivateIterable {
    [key: number]: number;
    length: number;
    private [Symbol.iterator](): Iterator<number>;
}

declare let privateIterable: PrivateIterable;

for (let i = 0; i < privateIterable.length; ++i) {
    privateIterable[i]
}
