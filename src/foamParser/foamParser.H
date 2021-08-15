/*---------------------------------------------------------------------------*\
  =========                 |
  \\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox
   \\    /   O peration     | Website:  https://openfoam.org
    \\  /    A nd           | Copyright (C) 2016-2019 OpenFOAM Foundation
     \\/     M anipulation  |
-------------------------------------------------------------------------------
License
    This file is part of OpenFOAM.

    OpenFOAM is free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    OpenFOAM is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
    FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
    for more details.

    You should have received a copy of the GNU General Public License
    along with OpenFOAM.  If not, see <http://www.gnu.org/licenses/>.

Class
    foamParser

Description
    Parses strings as OpenFOAM dictionaries

SourceFiles
    foamParser.C

Author
    Mohammed Elwardi Fadeli, All rights reserved
\*---------------------------------------------------------------------------*/

#ifndef foamParser_H
#define foamParser_H

#include "word.H"
#include "Pair.H"
#include "dictionary.H"
#include "messageStream.H"
#include <sstream>

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

namespace Foam
{

class foamParser
{

protected:
    
    // Protected Data Members

        //- Dummy dictionary, used for all operations
        dictionary dict_;

public:
    
    // Constructors

        //- Default constructors
	    foamParser();

    // Destructors

        //- Virtual Destructor
        virtual ~foamParser(){}

    // Public Member Methods

        //- Scoping format
        word scope(const fileName& entryName);

        //- Get dict name and keyword
        Pair<word> dictAndKeyword(const word& scopedName);

        //- lookup sub dict
        const dictionary& lookupScopedDict
        (
            const dictionary& dict,
            const word& subDictName
        );

        //- Return entry content as word
        word entryToWord(const entry& e);

        //- Get entry value in dictContent
        std::string getEntryValue
        (
            const std::string& entryName,
            const std::string& dictContent
        );

        //- Get entry keywords
        wordList getEntryKeywords
        (
            const std::string& entryName,
            const std::string& dictContent
        );
};

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

} // End namespace Foam

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

#endif

// ************************************************************************* //
