/*
    Document links for #include-family directives: click-through to the
    included file, resolved against the case layout and OpenFOAM env vars.
*/
'use strict';

import { DocumentLink } from 'vscode-languageserver-types';
import { FoamWorkspaceIndex } from './foamWorkspaceIndex';

export class FoamLinks {

    private index: FoamWorkspaceIndex | null;

    constructor(index?: FoamWorkspaceIndex) {
        this.index = index ?? null;
    }

    public getLinks(uri: string): DocumentLink[] {
        if (!this.index) {
            return [];
        }
        const links: DocumentLink[] = [];
        for (const include of this.index.includesOf(uri)) {
            if (include.targetUri) {
                links.push(DocumentLink.create(include.range, include.targetUri));
            }
        }
        return links;
    }

    public resolveLink(link: DocumentLink): DocumentLink {
        // targets are fully resolved at creation time
        return link;
    }
}
