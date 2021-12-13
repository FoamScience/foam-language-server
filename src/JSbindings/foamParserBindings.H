/*---------------------------------------------------------------------------*\
Class
    foamParserWrapper

Description
    JS Bindings for Foam::foamParser

SourceFiles
    foamParserBindings.cpp

Author
    Mohammed Elwardi Fadeli, All rights reserved
\*---------------------------------------------------------------------------*/

#ifndef foamParserBindings_H
#define foamParserBindings_H

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

class foamParser
:
    public Napi::ObjectWrap<foamParser>,
    public Foam::foamParser
{
    public:

        //- Init function
        static Napi::Object Init(Napi::Env env, Napi::Object exports);

        //- Construct from callback
        foamParser(const Napi::CallbackInfo& info);

    private:

        //- A reference to constructor
        static Napi::FunctionReference constructor;

        //- Wrapper for Foam::foamParser::getEntryValue
        Napi::Value GetEntryValue(const Napi::CallbackInfo& info);

        //- Wrapper for Foam::foamParser::getEntryKeywords
        Napi::Value GetEntryKeywords(const Napi::CallbackInfo& info);

        //- Wrapper for Foam::foamParser::getAllKeywords
        Napi::Value GetAllKeywords(const Napi::CallbackInfo& info);

        //- Wrapper for Foam::foamParser::getKeywordLineNumber
        Napi::Value GetKeywordLineNumber(const Napi::CallbackInfo& info);

        //- Pointer to parser object
        std::shared_ptr<Foam::foamParser> parser_;
};

#endif
