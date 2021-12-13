/*
    Linking OpenFOAM dictionaries to the outside world
    Author: Mohammed Elwardi Fadeli
    TODO: Promote OpenFOAM Wikis and User/Cpp guides

    Current Status:
    - Nothing
*/
'use strict';

import { DocumentLink } from 'vscode-languageserver-types';

export class FoamLinks {

    public getLinks(content: string): DocumentLink[] {
        let links = [];
        return links;
    }

    public resolveLink(link: DocumentLink): DocumentLink {
        if (link.data) {
            link.target =  "https://wiki.openfoam.com/" + link.data;
        }
        return link;
    }
}
