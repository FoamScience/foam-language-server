#include <napi.h>
#include <string>

#include "foamParser.H"
#include "foamParserBindings.C"

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  return foamParser::Init(env, exports);
}

NODE_API_MODULE(foamParser, InitAll)
