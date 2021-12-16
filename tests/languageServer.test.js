const fs = require('fs');
const lsp = require('vscode-languageserver-types');
const treeParser = require('../lib/foamfile-language-service/foamTreeParser.js').getParser();


// Typical dictionary content for OpenFOAM cases
let testContent = `
/*--------------------------------*- C++ -*----------------------------------*\
| =========                 |                                                 |
| \\      /  F ield         | foam-extend: Open Source CFD                    |
|  \\    /   O peration     | Version:     4.1                                |
|   \\  /    A nd           | Web:         http://www.foam-extend.org         |
|    \\/     M anipulation  |                                                 |
\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    location    "constant";
    object      transportProperties;
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

PS  10;

DT                 DT [ 0 2 -1 0 0 0 0] 0.01;

MP  1;
PPM 2;

type "cool";

someOtherDict {
    value Kool;
}

tool {
    More 2.2;
    list (1 2 3);
    deeper {
        index $:tool.list;
        inner $...MP;
        evenDeeper {
            just one;
        }
    }
}

ype L;

S          $DT;
ty
// ************************************************************************* //
`;


test('Get all symbols in a dictionary',
    () => {
        const parser = require('../lib/foamfile-language-service/foamSymbols');
        const syms = new parser.FoamSymbols(treeParser);
        const expectedSyms = 
        [
            'ty', // Note that incomplete symbols are also included
            'FoamFile', 'FoamFile.class', 'FoamFile.format', 'FoamFile.location', 'FoamFile.object', 'FoamFile.version',
            'PS', 'DT', 'MP', 'PPM', 'type', 'someOtherDict', 'someOtherDict.value', 
            'tool', 'tool.More', 'tool.list', 'tool.deeper', 'tool.deeper.index',
            'tool.deeper.inner', 'tool.deeper.evenDeeper', 'tool.deeper.evenDeeper.just',
            'ype', 'S'
        ];
        let keys = syms.parseSymbolInformation("", testContent).map(a => a.name);
        expect(keys.sort()).toEqual(expectedSyms.sort());
    }
);

test('Get macro keyword definition (Absolute path)',
    () => {
        // Test to see if definition for $:tool.list is correctly found
        const parser = require('../lib/foamfile-language-service/foamDefinition');
        const syms = new parser.FoamDefinition(treeParser);
        const expectedSyms = [32, 9]; 
        let keys = syms.computeDefinition("", testContent, lsp.Position.create(34, 20));//.map(a => a.name);
        expect([keys.range.start.line, keys.range.start.character]).toEqual(expectedSyms);
    }
);

test('Get Hover documentation for a keyword',
    () => {
        // Testing the "type" keyword
        const parser = require('../lib/foamfile-language-service/foamHover');
        const markup = require('../lib/foamfile-language-service/foamMarkdown');
        const docs = new markup.MarkdownDocumentation();
        const hover = new parser.FoamHover(docs, null, treeParser);
        const syms = hover.onHover(testContent, lsp.Position.create(24, 1), [lsp.MarkupKind.Markdown]);
        const expectedSyms = docs.getMarkdown("type").contents;
        expect(syms.contents.value).toEqual(expectedSyms);
    }
);

test('Get Signature help for a keyword',
    () => {
        // Testing the "type" keyword
        const parser = require('../lib/foamfile-language-service/foamSignatures')
        const markup = require('../lib/foamfile-language-service/foamPlainText');
        const docs = new markup.PlainTextDocumentation();
        const signatures = new parser.FoamSignatures(treeParser);
        const syms = signatures.computeSignatures(testContent, lsp.Position.create(24, 1));
        const expectedLabel = "Keyword: type";
        const expectedDocs = docs.getSignatureHelp("signature_type");
        const active = syms.activeSignature;
        expect(syms.signatures[active].label).toEqual(expectedLabel);
        expect(syms.signatures[active].documentation).toEqual(expectedDocs);
    }
);

test('Get Completion item for a keyword',
    () => {
        // Testing completion on "type" keyword when typing "ty"
        const parser = require('../lib/foamfile-language-service/foamAssist')
        const markup = require('../lib/foamfile-language-service/foamPlainText');
        const fc = require('../lib/foamfile-language-service/foamCompletion')
        const docs = new markup.PlainTextDocumentation();
        const document = lsp.TextDocument.create("", "foam", 0, testContent );
        const capabs = [];
        const comps = new parser.FoamAssist(document, capabs, treeParser);
        const resolver = new fc.FoamCompletion();
        props = comps.computeProposals(lsp.Position.create(45,2));
        expect(props[0].label).toEqual('type');
    }
);
