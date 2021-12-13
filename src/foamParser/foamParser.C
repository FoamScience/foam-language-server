#include "foamParser.H"
#include "error.H"
#include "IOstreams.H"
#include "addToRunTimeSelectionTable.H"
#include <functional>

// * * * * * * * * * * * * * * * * Constructors  * * * * * * * * * * * * * * //

Foam::foamParser::foamParser()
{
    FatalIOError.throwExceptions();
}

// * * * * * * * * * * * * * * * Member Functions  * * * * * * * * * * * * * //

Foam::word Foam::foamParser::scope
(
    const fileName& entryName
)
{
    if (entryName.find(':') != string::npos)
    {
        wordList entryNames(entryName.components(':'));

        word entry(entryNames[0]);
        for (label i = 1; i < entryNames.size(); i++)
        {
            entry += word('.') + entryNames[i];
        }
        return entry;
    }
    return entryName;
}

Foam::Pair<Foam::word> Foam::foamParser::dictAndKeyword
(
    const word& scopedName
)
{
    string::size_type i = scopedName.find_last_of(".");
    if (i != string::npos)
    {
        return Pair<word>
        (
            scopedName.substr(0, i),
            scopedName.substr(i+1, string::npos)
        );
    }
    return Pair<word>("", scopedName);
}

const Foam::dictionary& Foam::foamParser::lookupScopedDict
(
    const dictionary& dict,
    const word& subDictName
)
{
    if (subDictName == "")
    {
        return dict;
    }
    const entry* entPtr = dict.lookupScopedEntryPtr
    (
        subDictName,
        false,
        false
    );
    if (!entPtr || !entPtr->isDict())
    {
        FatalIOErrorInFunction(dict)
            << "keyword " << subDictName
            << " is undefined in dictionary "
            << dict.name() << " or is not a dictionary"
            << endl
            << "Valid keywords are " << dict.keys()
            << exit(FatalIOError);
    }
    return entPtr->dict();
}

Foam::word Foam::foamParser::entryToWord
(
    const entry& en
)
{
    OStringStream os;
    if (en.isStream())
    {
        auto pEntry = dynamic_cast<const primitiveEntry&>(en);
        if (pEntry)
        {
            // Get content only
            pEntry.write(os, true);
        }
    } else if (en.isDict())
    {
        os << en.dict() << endl;
    }
    return os.str();
}

std::string Foam::foamParser::getEntryValue
(
    const std::string& entryName,
    const std::string& dictContent
)
{
    // Prepare scoped name and string stream
    entry::disableFunctionEntries = true;
    word entryValue = "";
    word scopedName = scope(entryName);
    IStringStream is(dictContent);

    // Read dict content
    dict_.read(is);

    // Because dictionary::operator[] on some forks (eg. FE4)
    // is not scope aware sadly, we have to look it up manually
    const entry* entPtr = dict_.lookupScopedEntryPtr
    (
        scopedName,
        false,
        true            // Support wildcards
    );

    // Return empty if something is wrong with scoping
    if (!entPtr) return entryValue.c_str();
    entryValue = entryToWord(*entPtr);

    dict_.clear();

    // Return whetever we found as a word
    return entryValue.c_str();
}

Foam::wordList Foam::foamParser::getEntryKeywords
(
    const std::string& entryName,
    const std::string& dictContent
)
{
    // Prepare scoped name and string stream
    entry::disableFunctionEntries = true;
    word scopedName = scope(entryName);
    IStringStream is(dictContent);
    wordList keywords;

    // Read dict content
    dict_.read(is);

    // Because dictionary::operator[] on some forks (eg. FE4)
    // is not scope aware sadly, we have to look it up manually
    const entry* entPtr = dict_.lookupScopedEntryPtr
    (
        scopedName,
        false,
        true            // Support wildcards
    );

    // Return empty if something is wrong with scoping
    if (!entPtr || !entPtr->isDict()) return keywords;

    const dictionary& dict = entPtr->dict();
    forAllConstIter(dictionary, dict, iter)
    {
        keywords.append(iter().keyword());
    }

    dict_.clear();

    // Return populated keywords
    return keywords;
}

Foam::List<Foam::Tuple2<Foam::word, Foam::label>> Foam::foamParser::getAllKeywords
(
    const std::string& dictContent
)
{
    // Defaulting to not expanding macros ... etc
    // TODO: Make this an option of the LSP server
    // The entry `Entry $Var;` will point to Var's location (as a symbol) if this
    // is false
    entry::disableFunctionEntries = true;

    // Prepare return list and read in content
    IStringStream is(dictContent);
    dict_.read(is);
    List<Tuple2<word, label>> keywords;

    std::function<List<Tuple2<word, label>>(const dictionary&, const word)> getKeys =
        [&](const dictionary& dict, const word keyword) -> List<Tuple2<word, label>>
    {
        word newKey = keyword;
        List<Tuple2<word, label>> AllKeywords;
        if (dict.isDict(keyword))
        {
            //AllKeywords.append(Tuple2<word, label>(word(keyword), dict.subDict(keyword).startLineNumber()-1));
            forAllConstIter(dictionary, dict.subDict(keyword), iter)
            {
                word key = iter().keyword();
                label location = dict.subDict(keyword).isDict(key) ? iter().startLineNumber()-1 : iter().startLineNumber();
                AllKeywords.append(Tuple2<word, label>(word(keyword+"."+key), location));
                if (dict.subDict(keyword).isDict(key))
                {
                    List<Tuple2<word, label>> subKeys = getKeys(dict.subDict(keyword), key);
                    forAll(subKeys, ki)
                    {
                        AllKeywords.append(Tuple2<word, label>(keyword+"."+subKeys[ki].first(), subKeys[ki].second()));
                    }
                }
            }
        } else {
            AllKeywords.append(Tuple2<word, label>(keyword, dict.lookupEntry(keyword, false, false).startLineNumber()));
        }
        return AllKeywords;
    };


    List<Tuple2<word, label>> AllKeywords;
    forAllConstIter(dictionary, dict_, iter)
    {
        word key = iter().keyword();
        if (dict_.isDict(key))
        {
            AllKeywords.append(Tuple2<word, label>(word(key), dict_.subDict(key).startLineNumber()-1));
        }
        AllKeywords.append(getKeys(dict_, key));
    }

    dict_.clear();

    // Return populated keywords
    return AllKeywords;
}

int Foam::foamParser::getKeywordLineNumber
(
    const std::string& entryName,
    const std::string& dictContent
)
{
    entry::disableFunctionEntries = false;
    int lineNumber = -1;
    // Prepare scoped name and string stream
    word scopedName = scope(entryName);
    IStringStream is(dictContent);

    // Read dict content
    dict_.read(is);

    // Because dictionary::operator[] on some forks (eg. FE4)
    // is not scope aware sadly, we have to look it up manually
    const entry* entPtr = dict_.lookupScopedEntryPtr
    (
        scopedName,
        false,
        true            // Support wildcards
    );

    // Return empty if something is wrong with scoping
    if (!entPtr) return -1;
    lineNumber = entPtr->startLineNumber();

    dict_.clear();

    // Return whetever we found
    return lineNumber;
}

// ************************************************************************* //
