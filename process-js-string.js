/*
 * Copyright 2013 Amadeus s.a.s.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var UglifyJS = require("uglify-js");
var processAST = require("./process-js-ast")(UglifyJS);

module.exports = function(fileContent, fileName, options) {
    var ast;
    try {
        ast = UglifyJS.parse(fileContent, {
            filename : fileName
        });
    } catch (e) {
        if (e instanceof UglifyJS.JS_Parse_Error) {
            throw new Error(e.message + " (line: " + e.line + ", col: " + e.col + ", pos: " + e.pos + ")");
        }
        throw e;
    }
    fileContent = processAST(ast, fileContent, options);

    if (options.format) {
        fileContent = ast.print_to_string({
            comments : true,
            beautify : true,
            bracketize : true,
            ascii_only : true
        });
    }
    return fileContent;
};
