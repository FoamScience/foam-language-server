const parser = require('bindings')('foamParser');

const fp = new parser.foamParser();

//console.log('exports: ', greetModule);
//console.log();

const arr = fp.getEntryKeywords("keyword", "keyword { type k; value uniform 1; };");
console.log(arr);
