bar: for (;;) {
    break;
    bar: switch (true) {
        case true:
            break bar;
        default:
            continue bar;
    }
}
