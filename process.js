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

module.exports = function (UglifyJS) {
    var throwError = function (msg, code) {
        var e = new Error(msg + " (" + code + ")");
        e.code = code;
        throw e;
    };

    var reportError = function (errorMsg, item) {
        throw new Error([errorMsg, " in ", item.start.file, ' (line ', item.start.line, ')\n ', item.print_to_string()].join(''));
    };

    var acceptedAriaMethods = {
        // Don't transform resource definitions for now (as the new syntax is not supported for them):
        // 'resourcesDefinition' : 1,
        'classDefinition' : 1,
        'interfaceDefinition' : 1,
        'beanDefinitions' : 1,
        'tplScriptDefinition' : 1
    };

    var checkAriaDefinition = function (node) {
        // check that the walker is positioned in the argument of
        // an Aria.classDefinition, Aria.interfaceDefinition, Aria.tplScriptDefinition or Aria.beanDefinitions
        if (node instanceof UglifyJS.AST_Call) {
            var expr = node.expression;
            if (expr instanceof UglifyJS.AST_Dot) {
                var aria = expr.expression;
                if (aria instanceof UglifyJS.AST_SymbolRef && aria.name === "Aria"
                        && acceptedAriaMethods.hasOwnProperty(expr.property)) {
                    return expr.property;
                }
            }
        }
        // To check what is happening:
        // reportError('Not taking the property into account.', walker.self())
        return false;
    };

    var isUndeclaredSymbolRef = function (node, walker) {
        if (!(node instanceof UglifyJS.AST_SymbolRef && node.thedef.undeclared)) {
            return false;
        }
        if (node.name == "arguments" && walker.find_parent(UglifyJS.AST_Lambda)) {
            return false;
        }
        return true;
    };

    var Transformation = function (ast, sourceText, options) {
        this.ast = ast;
        if (sourceText) {
            sourceText = sourceText.replace(/\r\n?|[\n\u2028\u2029]/g, "\n").replace(/\uFEFF/g, '');
            this.sourceText = sourceText;
        }
        this.options = options || {};
    };

    Transformation.prototype.findAriaDefAndGlobals = function () {
        var ast = this.ast;
        ast.figure_out_scope();
        var ariaDefinition = null;
        var ariaDefinitionType = null;
        var globals = {};

        walker = new UglifyJS.TreeWalker(function (node) {
            var ariaDefType = checkAriaDefinition(node);
            if (ariaDefType) {
                if (ariaDefinition) {
                    reportError("Found multiple Aria definitions", node);
                } else {
                    ariaDefinition = {
                        node : node,
                        parent : walker.parent()
                    };
                    ariaDefinitionType = ariaDefType;
                }
            } else if (isUndeclaredSymbolRef(node, walker)) {
                var stack = walker.stack;
                var i = stack.length - 1;
                do {
                    var curNode = stack[i];
                    var propertyName = curNode.print_to_string();
                    if (!globals.hasOwnProperty(propertyName)) {
                        globals[propertyName] = [];
                    }
                    globals[propertyName].push({
                        node : curNode,
                        parent : stack[i - 1]
                    });
                    i--;
                } while (i >= 0 && stack[i] instanceof UglifyJS.AST_Dot);
            }
        });
        ast.walk(walker);

        if (globals["module"] || globals["require"]) {
            throwError("This file already uses 'module' or 'require'. It cannot be converted automatically. Perhaps it was already converted.", "alreadyConverted");
        }
        if (!ariaDefinition) {
            throwError("Could not find any Aria definition in this file.", "noAria");
        }
        this.ariaDefinition = ariaDefinition;
        this.ariaDefinitionType = ariaDefinitionType;
        this.globals = globals;
    };

    Transformation.prototype.findBootstrapDependencies = function () {
        var bootstrap = require("./at-bootstrap");
        var globals = this.globals;
        bootstrap.forEach(function (bootstrapGlobalName) {
            if (globals.hasOwnProperty(bootstrapGlobalName) && bootstrapGlobalName != this.classpath) {
                this.addDependency(bootstrapGlobalName, "JS");
            }
        }, this);
    };

    Transformation.prototype.findDependencies = function () {
        this.dependencies = {};

        var ariaDefParameter = this.ariaDefinition.node.args[0];
        if (!(ariaDefParameter instanceof UglifyJS.AST_Object)) {
            return reportError("Expected an object litteral for the Aria definition", ariaDefParameter);
        }
        this.addDependency("Aria", "JS", "ariatemplates/Aria", "Aria"); // a very special dependency
        ariaDefParameter.properties.forEach(function (property) {
            var fnName = "findDependenciesIn" + property.key;
            var fnRef = this[fnName];
            if (fnRef) {
                fnRef.call(this, property, ariaDefParameter);
            }
        }, this);
        if (this.parentClasspath) {
            this.parentType = this.parentType || "JS";
            if (!extensions.hasOwnProperty(this.parentType)) {
                return reportError("Incorrect value in $extendsType", value);
            }
            this.addDependencyFromNodeWithReplacement(this.parentType, this.parentClasspath.parent, this.parentClasspath.node);
        }
        this.findBootstrapDependencies();
    };

    var getBaseLogicalPath = function (classpath) {
        var array = classpath.split(".");
        if (array[0] === "aria") {
            array[0] = "ariatemplates";
        }
        return array.join("/");
    };

    var extensions = {
        JS : "",
        TPL : ".tpl",
        CSS : ".tpl.css",
        TML : ".tml",
        CML : ".cml",
        TXT : ".tpl.txt"
    };

    var createRequireNode = function (path) {
        return new UglifyJS.AST_Call({
            expression : new UglifyJS.AST_SymbolRef({
                name : "require"
            }),
            args : [new UglifyJS.AST_String({
                value : path
            })]
        });
    };

    var createRequireResourceNode = function (curDep, requesterBaseLogicalPath) {
        var serverResource = /([^\/]*)\/Res$/.exec(curDep.baseLogicalPath);
        var requireNode = createRequireNode(computeRelativePath(requesterBaseLogicalPath, "ariatemplates/$resources"));
        var args = [new UglifyJS.AST_String({
            value : curDep.baseRelativePath
        })];
        if (/^(.|..)\//.test(curDep.baseRelativePath)) {
            // relative path, include __dirname:
            args.unshift(new UglifyJS.AST_SymbolRef({
                name : "__dirname"
            }));
        }
        if (serverResource) {
            args.unshift(new UglifyJS.AST_String({
                value : serverResource[1]
            }));
        }
        return new UglifyJS.AST_Call({
            expression : new UglifyJS.AST_Dot({
                expression : requireNode,
                property : serverResource ? "module" : "file"
            }),
            args : args
        });
    };

    Transformation.prototype.addDependency = function (globalName, type, baseLogicalPath, varName) {
        var res = this.dependencies[globalName];
        if (!res) {
            var baseLogicalPath = baseLogicalPath || getBaseLogicalPath(globalName);
            this.dependencies[globalName] = res = {
                varName : varName,
                globalName : globalName,
                type : type,
                baseLogicalPath : baseLogicalPath,
                usages : []
            };
            var classpathGlobalUsages = this.globals[globalName];
            if (classpathGlobalUsages) {
                res.usages.push.apply(res.usages, classpathGlobalUsages);
            }
        }
        return res;
    };

    Transformation.prototype.addDependencyFromNode = function (type, parent, node) {
        if (!(node instanceof UglifyJS.AST_String)) {
            return reportError("Expected a string litteral", node);
        }
        return this.addDependency(node.value, type);
    };

    Transformation.prototype.addDependencyFromNodeWithReplacement = function (type, parent, node) {
        var dependency = this.addDependencyFromNode(type, parent, node);
        dependency.usages.push({
            parent : parent,
            node : node
        });
    };

    var findDepsInArray = function (type, doReplacements) {
        return function (node, parent) {
            var value = node.value;
            if (!(value instanceof UglifyJS.AST_Array)) {
                return reportError("Expected an array litteral in " + node.key, node.value);
            }
            var fnToCall = doReplacements ? this.addDependencyFromNodeWithReplacement : this.addDependencyFromNode;
            value.elements.forEach(fnToCall.bind(this, type, value));
            if (!doReplacements) {
                // we remove the node later because we are in a forEach loop on the array which we need to change
                this.removeNodeLater({
                    node : node,
                    parent : parent
                });
            }
        };
    };

    var findDepsInMap = function (type) {
        return function (node) {
            var value = node.value;
            if (!(value instanceof UglifyJS.AST_Object)) {
                return reportError("Expected an object litteral in " + node.key, node.value);
            }
            value.properties.forEach(function (property) {
                this.addDependencyFromNodeWithReplacement(type, property, property.value);
            }, this);
        };
    };

    Transformation.prototype.findDependenciesIn$classpath = function (property) {
        if (this.ariaDefinitionType === "beanDefinitions") {
            return;
        }
        var value = property.value
        if (!(value instanceof UglifyJS.AST_String)) {
            return reportError("Expected an string litteral in $classpath", value);
        }
        this.classpath = value.value;
        this.baseLogicalPath = getBaseLogicalPath(this.classpath);
    };

    Transformation.prototype.findDependenciesIn$package = function (property) {
        if (this.ariaDefinitionType !== "beanDefinitions") {
            return;
        }
        var value = property.value
        if (!(value instanceof UglifyJS.AST_String)) {
            return reportError("Expected an string litteral in $package", value);
        }
        this.classpath = value.value;
        this.baseLogicalPath = getBaseLogicalPath(this.classpath);
    };

    Transformation.prototype.findDependenciesIn$extends = function (property) {
        this.parentClasspath = {
            parent : property,
            node : property.value
        };
    };

    Transformation.prototype.findDependenciesIn$extendsType = function (property, parent) {
        var value = property.value
        if (!(value instanceof UglifyJS.AST_String)) {
            return reportError("Expected a string in $extendsType", value);
        }
        this.parentType = value.value;
        this.removeNodeLater({
            node : property,
            parent : parent
        });
    };

    Transformation.prototype.findDependenciesIn$implements = findDepsInArray("JS", true);
    Transformation.prototype.findDependenciesIn$dependencies = findDepsInArray("JS", false);
    Transformation.prototype.findDependenciesIn$resources = function (node) {
        if (this.ariaDefinitionType === "resourcesDefinition") {
            // in a file with Aria.resourcesDefinition, $resources does not contain dependencies like in other file
            // types
            return;
        }
        var value = node.value;
        if (!(value instanceof UglifyJS.AST_Object)) {
            return reportError("Expected an object litteral in $resources", node.value);
        }
        value.properties.forEach(function (property) {
            if (property.value instanceof UglifyJS.AST_String) {
                this.addDependencyFromNodeWithReplacement("RES", property, property.value);
            } else if (property.value instanceof UglifyJS.AST_Object) {
                return reportError("This tool does not support the conversion of resource providers in $resources", property);
            } else {
                return reportError("Expected either a string litteral or an object litteral in $resources", property);
            }
        }, this);
    };
    Transformation.prototype.findDependenciesIn$templates = findDepsInArray("TPL", false);
    Transformation.prototype.findDependenciesIn$css = findDepsInArray("CSS", true);
    Transformation.prototype.findDependenciesIn$macrolibs = findDepsInArray("TML", false);
    Transformation.prototype.findDependenciesIn$csslibs = findDepsInArray("CML", false);
    Transformation.prototype.findDependenciesIn$texts = findDepsInMap("TXT");
    Transformation.prototype.findDependenciesIn$namespaces = findDepsInMap("JS");

    Transformation.prototype.createVarName = function (dependency) {
        return dependency.globalName.replace(/[^a-zA-Z0-9]+/g, "_").split("_").map(function (part, index) {
            if (index == 0) {
                return part.charAt(0).toLowerCase() + part.substring(1);
            } else {
                return part.charAt(0).toUpperCase() + part.substring(1);
            }
        }).join("");
    };

    var createModuleDotExports = function () {
        return new UglifyJS.AST_Dot({
            expression : new UglifyJS.AST_SymbolRef({
                name : "module"
            }),
            property : "exports"
        });
    };

    var computeRelativePath = function (refPath, logicalPath) {
        var refParts = refPath.split("/");
        var targetParts = logicalPath.split("/");
        var maxCommon = Math.min(refParts.length, targetParts.length) - 1;
        var commonItems = 0;
        while (commonItems < maxCommon && refParts[commonItems] == targetParts[commonItems]) {
            commonItems++;
        }
        if (commonItems == 0) {
            return logicalPath;
        }
        targetParts.splice(0, commonItems);
        var parentsCount = refParts.length - 1 - commonItems;
        if (parentsCount == 0) {
            targetParts.unshift(".");
        } else {
            for (var i = 0; i < parentsCount; i++) {
                targetParts.unshift("..");
            }
        }
        return targetParts.join("/");
    };

    Transformation.prototype.insertRequires = function () {
        this.replaceNodeLater(this.ariaDefinition, new UglifyJS.AST_Assign({
            left : createModuleDotExports(),
            operator : "=",
            right : this.ariaDefinition.node
        }), this.insertModuleExportsInString);
        var keepRequiresTop = this.options.keepRequiresTop;
        var dependencies = this.dependencies;
        for (var depName in dependencies) {
            var curDep = dependencies[depName];
            var requireNode;
            curDep.baseRelativePath = computeRelativePath(this.baseLogicalPath, curDep.baseLogicalPath);
            if (curDep.type == "RES") {
                requireNode = createRequireResourceNode(curDep, this.baseLogicalPath);
            } else {
                requireNode = createRequireNode(curDep.baseRelativePath + extensions[curDep.type]);
            }
            var nbUsages = curDep.usages.length;
            if (curDep.varName || nbUsages > 1 || nbUsages === 1 && keepRequiresTop) {
                var varName = curDep.varName || this.createVarName(curDep);
                this.insertNodeLater(new UglifyJS.AST_Var({
                    definitions : [new UglifyJS.AST_VarDef({
                        name : new UglifyJS.AST_SymbolVar({
                            name : varName
                        }),
                        value : requireNode
                    })]
                }));
                curDep.usages.forEach(function (usageNode) {
                    this.replaceNodeLater(usageNode, new UglifyJS.AST_SymbolRef({
                        name : varName
                    }));
                }, this);
            } else if (nbUsages === 1) {
                this.replaceNodeLater(curDep.usages[0], requireNode);
            } else {
                this.insertNodeLater(new UglifyJS.AST_SimpleStatement({
                    body : requireNode
                }));
            }
        }
        if (this.globals.hasOwnProperty(this.classpath) && this.options.replaceOwnClasspath) {
            this.globals[this.classpath].forEach(function (usageNode) {
                this.replaceNodeLater(usageNode, createModuleDotExports());
            }, this);
        }
        this.doLaterOperations();
    };

    var replaceNodeInArray = function (array, oldNode, newNode) {
        for (var i = 0, l = array.length; i < l; i++) {
            if (array[i] === oldNode) {
                if (newNode) {
                    array[i] = newNode;
                } else {
                    array.splice(i, 1);
                }
                return {
                    array : array,
                    index : i
                };
            }
        }
        return false;
    };

    var replaceNodeInProperties = function (parent, oldNode, newNode) {
        var properties = parent.CTOR.PROPS;
        for (var i = 0, l = properties.length; i < l; i++) {
            var curProperty = properties[i];
            var curValue = parent[curProperty];
            if (curValue === oldNode) {
                if (newNode) {
                    parent[curProperty] = newNode;
                } else {
                    delete parent[curProperty];
                }
                return {
                    property : curProperty
                };
            } else if (Array.isArray(curValue)) {
                var res = replaceNodeInArray(curValue, oldNode, newNode)
                if (res) {
                    return res;
                }
            }
        }
        return false;
    };

    var methodsOrder = {
        "insertNode" : -1,
        "replaceNode" : 1
    };

    var sortOperations = function (op1, op2) {
        if (op1.position != op2.position) {
            return op1.position - op2.position;
        } else if (op1.method != op2.method) {
            // for the same position, insertNode is before replaceNode
            return methodsOrder[op1.method] - methodsOrder[op2.method];
        } else {
            return op1.order - op2.order;
        }
    };

    Transformation.prototype.doLaterOperations = function () {
        if (!this.laterOperations) {
            return;
        }
        this.laterOperations.sort(sortOperations);
        while (this.laterOperations.length > 0) {
            var operation = this.laterOperations.pop();
            this[operation.method].apply(this, operation.arguments);
        }
    };

    Transformation.prototype.insertNodeLater = function () {
        if (!this.laterOperations) {
            this.laterOperations = [];
        }
        this.laterOperations.push({
            order : this.laterOperations.length,
            position : this.findInsertPosition(),
            method : "insertNode",
            arguments : arguments
        });
    };

    Transformation.prototype.replaceNodeLater = function (nodeAndParent, newNode) {
        if (!this.laterOperations) {
            this.laterOperations = [];
        }
        this.laterOperations.push({
            order : this.laterOperations.length,
            position : nodeAndParent.node.start.pos,
            method : "replaceNode",
            arguments : arguments
        });
    };

    Transformation.prototype.removeNodeLater = function (nodeAndParent) {
        this.replaceNodeLater(nodeAndParent);
    };

    Transformation.prototype.replaceNodeInString = function (nodeAndParent, newNode, changeInfo) {
        var node = nodeAndParent.node;
        var sourceText = this.sourceText;
        var newNodeText = "";
        var start = node.start.pos;
        var end = node.end.endpos;
        if (newNode) {
            newNodeText = newNode.print_to_string({
                beautify : true
            });
            if (!(newNode instanceof UglifyJS.AST_Statement || newNode instanceof UglifyJS.AST_SymbolRef)) {
                newNodeText = "(" + newNodeText + ")";
            }
        } else {
            // removing a node is a bit more complex, as there can be an extra comma
            var array = changeInfo.array;
            if (array) {
                var index = changeInfo.index;
                if (index > 0) {
                    // also remove the preceding comma if any
                    start = array[index - 1].end.endpos;
                } else if (array.length > 0) {
                    // also remove the next comma if any
                    end = array[index].start.pos;
                }
            }
        }
        this.sourceText = sourceText.substr(0, start) + newNodeText + sourceText.substr(end);
    };

    Transformation.prototype.insertModuleExportsInString = function (nodeAndParent, newNode) {
        var node = nodeAndParent.node;
        var pos = node.start.pos;
        var sourceText = this.sourceText;
        this.sourceText = sourceText.substr(0, pos) + "module.exports = " + sourceText.substr(pos);
    };

    Transformation.prototype.replaceNode = function (nodeAndParent, newNode, stringOperation) {
        var parent = nodeAndParent.parent;
        var node = nodeAndParent.node
        if (newNode && !newNode.start) {
            // this is needed because of a bug in uglify-js if start is not defined on some specific nodes
            newNode.start = {
                comments_before : []
            };
        }
        var res = replaceNodeInProperties(parent, node, newNode);
        if (res) {
            if (this.sourceText) {
                stringOperation = stringOperation || this.replaceNodeInString;
                stringOperation.call(this, nodeAndParent, newNode, res);
            }
            return;
        }
        reportError("Internal error: unable to find the node to replace", node);
    };

    Transformation.prototype.removeNode = function (nodeAndParent) {
        this.replaceNode(nodeAndParent, null);
    };

    var isGlobalComment = function (comment) {
        return /copyright|license|jshint/i.test(comment);
    };

    var filterStart = function (start) {
        if (!start) {
            return;
        }
        var firstComments = [];
        var laterComments = start.comments_before;
        while (laterComments.length > 0 && isGlobalComment(laterComments[0].value)) {
            firstComments.push(laterComments.shift())
        }
        return {
            nlb : true,
            comments_before : firstComments
        };
    };

    Transformation.prototype.findInsertPosition = function () {
        if (this._insertPosition == null) {
            var start = this.ast.start = filterStart(this.ast.start);
            if (start && start.comments_before.length > 0) {
                var lastComment = start.comments_before[start.comments_before.length - 1];
                this._insertPosition = lastComment.endpos;
            } else {
                this._insertPosition = 0;
            }
        }
        return this._insertPosition;
    };

    Transformation.prototype.insertNodeInString = function (node) {
        var sourceText = this.sourceText;
        var newNodeText = node.print_to_string({
            beautify : true
        });
        var pos = this.findInsertPosition();
        if (this._alreadyInsertedNode) {
            pos += 1;
            newNodeText += "\n";
        } else {
            newNodeText = "\n" + newNodeText + "\n";
            this._alreadyInsertedNode = true;
        }
        this.sourceText = sourceText.substr(0, pos) + newNodeText + sourceText.substr(pos);
    };

    Transformation.prototype.insertNode = function (node) {
        if (this.sourceText) {
            this.insertNodeInString(node);
        }
        this.ast.body.splice(0, 0, node);
    };

    return function (ast, sourceText, options) {
        var scope = new Transformation(ast, sourceText, options);
        scope.findAriaDefAndGlobals();
        scope.findDependencies();
        scope.insertRequires();
        return scope.sourceText;
    };
};