/*
    Deals with command-like text in OpenFOAM dictionaries
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Apparently commands are not needed for now, Fatal errors get passed untouched
*/
'use strict';

import { TextDocument, Command, Diagnostic, Range, TextEdit } from 'vscode-languageserver-types';
import { ValidationCode } from '../foamfile-utils/main';
import { CommandIds } from './main';

export class FoamCommands {

    public analyzeDiagnostics(diagnostics: Diagnostic[], textDocumentURI: string): Command[] {
        let commands: Command[] = [];
        for (let i = 0; i < diagnostics.length; i++) {
            // Diagnostic's code is (number | string), convert it if necessary
            if (typeof diagnostics[i].code === "string") {
                diagnostics[i].code = parseInt(diagnostics[i].code as string);
            }
            switch (diagnostics[i].code) {
                case ValidationCode.FOAM_FATAL_ERROR:
                    commands.push({
                        title: "FOAM FATAL ERROR",
                        command: CommandIds.FATAL_ERROR,
                        arguments: [textDocumentURI, diagnostics[i].range]
                    });
                    break;
                case ValidationCode.FOAM_FATAL_IO_ERROR:
                    commands.push({
                        title: "FOAM FATAL IO ERROR",
                        command: CommandIds.FATAL_IO_ERROR,
                        arguments: [textDocumentURI, diagnostics[i].range]
                    });
                    break;
            }
        }
        return commands;
    }

    // Disabled for now
    public computeCommandEdits(content: string, command: string, args: any[]): TextEdit[] {
        return null;
    }

}
