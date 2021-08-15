{
  "targets": [
    {
      "target_name": "foamParser",
      "cflags_cc": [
        '-std=c++14',
        '-fexceptions',
        '-frtti',
        '-m64',
        '-Dlinux64',
        '-DWM_ARCH_OPTION=64',
        '-DWM_DP',
        '-DWM_LABEL_SIZE=32',
        '-DNoRepository',
        '-ftemplate-depth-200'
      ],
      "sources": [
        "./src/JSbindings/JSbindings.cpp"
      ],
      'libraries':
      [
          '<!(echo $FOAM_LIBBIN/libfoam.so)',
          '<!(echo $FOAM_USER_LIBBIN/libfoamParser.so)'
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        './src/lnInclude',
        '<!(echo $FOAM_SRC/foam/lnInclude)'
      ],
      'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ],
    }
  ]
}
