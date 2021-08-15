#!/bin/bash

# Installation script for foamParser
####################################

# Requirements:
# 1. Sourced OpenFOAM environment
# 2. node-gyp installed globally

# Assumes it is ran from project root directory
# Checks for OpenFOAM, builds foamParser C++ library, then gets bindings ready

# Meta functions

buildFoamParserLibrary()
{
    cd src; wclean; wmake libso; cd -
}

buildAddon()
{
    node-gyp rebuild
}

if [[ -z "${WM_PROJECT}" ]]; then
    echo ""
    echo -n "OpenFOAM not sourced, please source OpenFOAM's bashrc before running this script"
    exit 1
fi

case ${WM_PROJECT} in

    "foam")
        echo -n "Supported"
        buildFoamParserLibrary
        buildAddon
        ;;
    *)
        echo -n "OpenFOAM fork not supported"
        exit 1
        ;;
esac
