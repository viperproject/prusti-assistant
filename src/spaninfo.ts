import * as util from "./util";
import * as config from "./config";
import * as vscode from "vscode";
import * as path from "path";
import * as dependencies from "./dependencies";

export * from "./dependencies/PrustiLocation";
import * as tools from "vs-verification-toolbox";
import * as server from "./server";
import * as rustup from "./dependencies/rustup";
import { PrustiLocation } from "./dependencies/PrustiLocation";
import { prustiTools } from "./dependencies/prustiTools";



export async function spanInfo(prusti: PrustiLocation, serverAddress: string, destructors: Set<util.KillFunction>): Promise<string> {
    const active_editor = vscode.window.activeTextEditor;
    if (!active_editor) {
        return "no info currently";
    }
    console.log("reached function spaninfo");
    const doc = active_editor.document;
    const selection = active_editor.selection;
    const offset = doc.offsetAt(selection.anchor);
    const programPath = doc.fileName;
    
    const prustiRustcArgs = [
        "-Pshow_ide_info=true",
        "--crate-type=lib",
        "--error-format=json",
        programPath
    ].concat(
        config.extraPrustiRustcArgs()
    );
    const prustiRustcEnv = {
        ...process.env,  // Needed to run Rustup
        ...{
            PRUSTI_SERVER_ADDRESS: serverAddress,
            PRUSTI_QUIET: "true",
            JAVA_HOME: (await config.javaHome())!.path,
        },
        ...config.extraPrustiEnv(),
    }
    // todo: find the end of this token. Or should this be done in rust?
    // flowistry apparently does this in rust
    const output = await util.spawn(
        prusti.prustiRustc,
        prustiRustcArgs,
        {
            options: {
                cwd: path.dirname(programPath),
                env: prustiRustcEnv,
            }
        },
        destructors
    )
    //
    // todo: parse the output
    // let obj = JSON.parse(output.stdout);
    return output.stdout;
    
    // await util.spawn(prusti!.prustiRustc, ["--Pspaninfo", offset.toString(), doc.fileName]);
    // need to get info
    // return doc.fileName +":"+ offset.toString();
}