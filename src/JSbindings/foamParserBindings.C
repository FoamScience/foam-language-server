#include "foamParserBindings.H"

// Static members
Napi::FunctionReference foamParser::constructor;

// Init Function
Napi::Object foamParser::Init(Napi::Env env, Napi::Object exports) 
{
    Napi::HandleScope scope(env);

    // Expose member functions
    Napi::Function func = DefineClass(env, "foamParser", {
        InstanceMethod("getEntryValue", &foamParser::GetEntryValue),
        InstanceMethod("getEntryKeywords", &foamParser::GetEntryKeywords),
    });

    // Bind to persistent construct
    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    // Export the class
    exports.Set("foamParser", func);
    return exports;
}

// Constructor
foamParser::foamParser(const Napi::CallbackInfo& info)
:
    Napi::ObjectWrap<foamParser>(info),
    parser_(new Foam::foamParser())
{
}

// Wrap Foam::foamParser::getEntryValue
Napi::Value foamParser::GetEntryValue(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::HandleScope scope(env);

    // Make sure JS args are two strings
    int length = info.Length();
    if (length != 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "2 strings expected")
            .ThrowAsJavaScriptException();
    }

    // Pass args to Foam class and try to execute member function
    Napi::String keyword = info[0].As<Napi::String>(); 
    Napi::String content = info[1].As<Napi::String>(); 
    std::string result;
    try {
      result = this->parser_->getEntryValue(keyword.ToString(), content.ToString());
    } catch (const std::exception& e)
    {
        Napi::Error::New(env, "Ill keyword definition : " + std::string(keyword))
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Return result if successful
    return Napi::String::New(env, result);
}

// Wrap Foam::foamParser::getEntryKeywords
Napi::Value foamParser::GetEntryKeywords(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::HandleScope scope(env);

    // Make sure JS args are two strings
    int length = info.Length();
    if (length != 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "2 strings expected")
            .ThrowAsJavaScriptException();
    }

    // Pass args to Foam class and try to execute member function
    Napi::String keyword = info[0].As<Napi::String>(); 
    Napi::String content = info[1].As<Napi::String>(); 
    Foam::wordList result;
    try {
      result = this->parser_->getEntryKeywords(keyword.ToString(), content.ToString());
    } catch (const std::exception& e)
    {
        Napi::Error::New(env, "Ill keyword definition : " + std::string(keyword))
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array resultAr = Napi::Array::New(env);
    forAll(result, ii)
    {
        Napi::HandleScope scope(env);
        resultAr[ii] = Napi::String::New(env, result[ii]);
    }
    // Return result if successful
    return resultAr;
}
