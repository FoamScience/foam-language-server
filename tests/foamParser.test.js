const parser = require('../build/Release/foamParser.node');

const fp = new parser.foamParser();

test('Get value from a simple key-value pair',
    () => {
        expect(fp.getEntryValue("keyword", "keyword 1;")).toBe("1");
    }
);

test('Error when getting value from invalid key-value pair',
    () => {
        expect(() => {fp.getEntryValue("keyword", "keyword 1")}).toThrow();
    }
);

test('Get keywords from a simple dictionary',
    () => {
        const arr = fp.getEntryKeywords("keyword", "keyword {type 1; value uniform 0;}");
        expect(arr[0]).toBe("type");
        expect(arr[1]).toBe("value");
    }
);

test('Error when getting keywords from an invalid dictionary',
    () => {
        expect(() => {
            fp.getEntryKeywords("keyword", "keyword {type 1; value uniform 0}")
        }).toThrow();
    }
);

test('Get line number from a dictionary of expanded macro keyword',
    () => {
        expect(fp.getKeywordLineNumber("keyword", "somethingElse 0;\nll 1;\nkeyword $ll;\n")).toBe(1);
    }
);
