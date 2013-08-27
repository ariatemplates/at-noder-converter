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

var reportError = function (errorMsg, item) {
    throw new Error([errorMsg, " in ", item.start.file, ' (line ', item.start.line, ')\n ', item.print_to_string()].join(''));
};

var acceptedAriaMethods = {
    'classDefinition' : 1,
    'interfaceDefinition' : 1,
    'beanDefinitions' : 1,
    'tplScriptDefinition' : 1,
    'resourcesDefinition' : 1
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

var Transformation = function (ast) {
    this.ast = ast;
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
        throw new Error("This file already uses 'module' or 'require'. It cannot be converted automatically. Perhaps it was already converted.");
    }
    if (!ariaDefinition) {
        throw new Error("Could not find any Aria definition in this file.");
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
    this.addDependency("Aria", "JS", "aria/Aria", "Aria"); // a very special dependency
    ariaDefParameter.properties.forEach(function (property) {
        var fnName = "findDependenciesIn" + property.key;
        var fnRef = this[fnName];
        if (fnRef) {
            fnRef.call(this, property, ariaDefParameter);
        }
    }, this);
    if (this.parentClasspath) {
        this.parentType = this.parentType || "JS";
        if (!extensions.hasOwnProperty(this.parentType) || this.parentType === "RES") {
            return reportError("Incorrect value in $extendsType", value);
        }
        this.addDependencyFromNodeWithReplacement(this.parentType, this.parentClasspath.parent, this.parentClasspath.node);
    }
    this.findBootstrapDependencies();
};

var getBaseLogicalPath = function (classpath) {
    return classpath.replace(/\./g, '/');
};

var extensions = {
    JS : "",
    TPL : ".tpl",
    RES : ".ATres",
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
    var value = property.value
    if (!(value instanceof UglifyJS.AST_String)) {
        return reportError("Expected an string litteral in $classpath", value);
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
        // in a file with Aria.resourcesDefinition, $resources does not contain dependencies like in other file types
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
            var provider = property.value;
            var properties = provider.properties;
            var providerProperty;
            for (var i = 0, l = properties.length; i < l; i++) {
                if (properties[i].key === "provider") {
                    providerProperty = properties[i];
                    break;
                }
            }
            if (!providerProperty) {
                return reportError("Expected a provider property in $resources", property);
            }
            this.addDependencyFromNodeWithReplacement("JS", providerProperty, providerProperty.value);
        } else {
            return reportError("Expected either a string litteral or an object litteral in $resources", property);
        }
    }, this);
};
Transformation.prototype.findDependenciesIn$templates = findDepsInArray("TPL", false);
Transformation.prototype.findDependenciesIn$css = findDepsInArray("CSS", true);
Transformation.prototype.findDependenciesIn$macrolibs = findDepsInArray("TML", true);
Transformation.prototype.findDependenciesIn$csslibs = findDepsInArray("CML", true);
Transformation.prototype.findDependenciesIn$texts = findDepsInMap("TXT");
Transformation.prototype.findDependenciesIn$namespaces = findDepsInMap("JS", true);

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
    var dependencies = this.dependencies;
    for (var depName in dependencies) {
        var curDep = dependencies[depName];
        curDep.baseRelativePath = computeRelativePath(this.baseLogicalPath, curDep.baseLogicalPath);
        var requireNode = createRequireNode(curDep.baseRelativePath + extensions[curDep.type]);
        if (curDep.varName || curDep.usages.length > 1) {
            var varName = curDep.varName || this.createVarName(curDep);
            this.insertNode(new UglifyJS.AST_Var({
                definitions : [new UglifyJS.AST_VarDef({
                    name : new UglifyJS.AST_SymbolVar({
                        name : varName
                    }),
                    value : requireNode
                })]
            }));
            curDep.usages.forEach(function (usageNode) {
                this.replaceNode(usageNode, new UglifyJS.AST_SymbolRef({
                    name : varName
                }));
            }, this);
        } else if (curDep.usages.length == 1) {
            this.replaceNode(curDep.usages[0], requireNode);
        } else {
            this.insertNode(new UglifyJS.AST_SimpleStatement({
                body : requireNode
            }));
        }
    }
    this.replaceNode(this.ariaDefinition, new UglifyJS.AST_Assign({
        left : createModuleDotExports(),
        operator : "=",
        right : this.ariaDefinition.node
    }));
    if (this.globals.hasOwnProperty(this.classpath)) {
        this.globals[this.classpath].forEach(function (usageNode) {
            this.replaceNode(usageNode, createModuleDotExports());
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
            return true;
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
            return true;
        } else if (Array.isArray(curValue)) {
            if (replaceNodeInArray(curValue, oldNode, newNode)) {
                return true;
            }
        }
    }
    return false;
};

Transformation.prototype.doLaterOperations = function () {
    if (!this.laterOperations) {
        return;
    }
    while (this.laterOperations.length > 0) {
        var operation = this.laterOperations.shift();
        this[operation.method].apply(this, operation.arguments);
    }
};

Transformation.prototype.replaceNodeLater = function () {
    if (!this.laterOperations) {
        this.laterOperations = [];
    }
    this.laterOperations.push({
        method : "replaceNode",
        arguments : arguments
    });
};

Transformation.prototype.removeNodeLater = function (nodeAndParent) {
    this.replaceNodeLater(nodeAndParent);
};

Transformation.prototype.replaceNode = function (nodeAndParent, newNode) {
    var parent = nodeAndParent.parent;
    var node = nodeAndParent.node
    if (newNode && !newNode.start) {
        // this is needed because of a bug in uglify-js if start is not defined on some specific nodes
        newNode.start = {
            comments_before : []
        };
    }
    if (replaceNodeInProperties(parent, node, newNode)) {
        return;
    }
    reportError("Internal error: unable to find the node to replace", node);
};

Transformation.prototype.removeNode = function (nodeAndParent) {
    this.replaceNode(nodeAndParent, null);
};

var isGlobalComment = function (comment) {
    return /copyright|license/i.test(comment);
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

Transformation.prototype.insertNode = function (node) {
    if (!this.insertNodeCalls) {
        this.insertNodeCalls = 0;
        // keep the copyright comment, if any, at the very beginning of the file:
        this.ast.start = filterStart(this.ast.start);
    }
    this.ast.body.splice(this.insertNodeCalls, 0, node);
    this.insertNodeCalls++;
};

module.exports = function (ast) {
    var scope = new Transformation(ast);
    scope.findAriaDefAndGlobals();
    scope.findDependencies();
    scope.insertRequires();
};
