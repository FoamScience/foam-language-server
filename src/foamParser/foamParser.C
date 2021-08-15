#include "foamParser.H"
#include "error.H"
#include "IOstreams.H"
#include "addToRunTimeSelectionTable.H"

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
    if (!entPtr) return "";

    // Return whetever we found as a word
    return entryToWord(*entPtr).c_str();
}

Foam::wordList Foam::foamParser::getEntryKeywords
(
    const std::string& entryName,
    const std::string& dictContent
)
{
    // Prepare scoped name and string stream
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

    // Return populated keywords
    return keywords;
}

// ************************************************************************* //
