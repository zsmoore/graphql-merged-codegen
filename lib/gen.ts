import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildSchema,
  DefinitionNode,
  DocumentNode,
  FragmentDefinitionNode,
  GraphQLSchema,
  OperationDefinitionNode,
  parse,
  SelectionSetNode,
  SelectionNode,
  FieldNode,
  visit,
  visitWithTypeInfo,
  TypeInfo,
  GraphQLOutputType,
  GraphQLObjectType,
  GraphQLNonNull,
  GraphQLScalarType,
  GraphQLEnumType,
  GraphQLList,
} from 'graphql';
import { Maybe } from 'graphql/jsutils/Maybe';
/* eslint-disable import/extensions */
/* eslint-disable import/no-unresolved */
import MetaType from './meta-type';
/* eslint-enable import/extensions */
/* eslint-enable import/no-unresolved */

function parseInputQueries(
  pathToQueries: string,
): DocumentNode[] {
  return readdirSync(pathToQueries).flatMap((file) => {
    const path = join(pathToQueries, file);
    if (statSync(path).isDirectory()) {
      return parseInputQueries(path);
    }
    return parse(readFileSync(path).toString());
  });
}

function filterToOperations(arr: readonly DefinitionNode[]): OperationDefinitionNode[] {
  return arr.filter((el) => el.kind === 'OperationDefinition') as OperationDefinitionNode[];
}

function filterToQueries(arr: readonly OperationDefinitionNode[]) : OperationDefinitionNode[] {
  return arr.filter((el) => el.operation === 'query');
}

function getQuery(document: DocumentNode): OperationDefinitionNode | undefined {
  const queries = filterToQueries(filterToOperations(document.definitions));
  return queries[0];
}

function getFragmentDefinitions(document: DocumentNode): FragmentDefinitionNode[] {
  const fragmentDefinitions: FragmentDefinitionNode[] = [];
  visit(document, {
    FragmentDefinition(node) {
      fragmentDefinitions.push(node);
    },
  });
  return fragmentDefinitions;
}

function getSelectionSetsFromFragmentDefinitions(
  arr: readonly FragmentDefinitionNode[],
): Map<string, SelectionSetNode> {
  const fragmentNameToSelectionSet: Map<string, SelectionSetNode> = new Map();
  arr.forEach((node) => fragmentNameToSelectionSet.set(node.name.value, node.selectionSet));
  return fragmentNameToSelectionSet;
}

function expandSelectionNode(
  node: SelectionNode,
  selectionSetsForFragmentDefs: Map<string, SelectionSetNode>,
): readonly SelectionNode[] {
  if (node.kind === 'Field') {
    let newSelectionSet: SelectionSetNode | undefined;
    if (node.selectionSet) {
      newSelectionSet = {
        kind: node.selectionSet.kind,
        loc: node.selectionSet.loc,
        selections: node.selectionSet.selections.flatMap((selectionNode) => expandSelectionNode(
          selectionNode,
          selectionSetsForFragmentDefs,
        )),
      };
    }
    const newField: FieldNode = {
      kind: node.kind,
      loc: node.loc,
      alias: node.alias,
      name: node.name,
      arguments: node.arguments,
      directives: node.directives,
      selectionSet: newSelectionSet,
    };
    return [newField];
  } if (node.kind === 'FragmentSpread') {
    const selectionSetForFragment:
    SelectionSetNode | undefined = selectionSetsForFragmentDefs.get(node.name.value);
    return selectionSetForFragment
      ?.selections
      ?.flatMap((selectionNode) => expandSelectionNode(
        selectionNode,
        selectionSetsForFragmentDefs,
      )) || [];
  } if (node.kind === 'InlineFragment') {
    // Inline Fragment
    return node.selectionSet.selections.flatMap((selectionNode) => expandSelectionNode(
      selectionNode,
      selectionSetsForFragmentDefs,
    ));
  }
  return [];
}

function getReWrittenSelectionSet(
  arr: readonly SelectionNode[],
  selectionSetsForFragmentDefs: Map<string, SelectionSetNode>,
): SelectionNode[] {
  return arr.flatMap((selectionNode) => expandSelectionNode(
    selectionNode,
    selectionSetsForFragmentDefs,
  ));
}

function reWriteAstToSelectionSets(
  query: OperationDefinitionNode,
  document: DocumentNode,
): SelectionSetNode {
  const fragmentDefs: FragmentDefinitionNode[] = getFragmentDefinitions(document);
  const selectionSetsForFragmentDefs:
    Map<string, SelectionSetNode> = getSelectionSetsFromFragmentDefinitions(fragmentDefs);
  const rootQuerySelectionSetNode: SelectionSetNode = query.selectionSet;
  const rootNode: SelectionSetNode = {
    kind: rootQuerySelectionSetNode.kind,
    loc: rootQuerySelectionSetNode.loc,
    selections: getReWrittenSelectionSet(
      rootQuerySelectionSetNode.selections,
      selectionSetsForFragmentDefs,
    ),
  };
  return rootNode;
}

function getQueryAndReWriteASTToSelectionSets(
  document: DocumentNode,
): DocumentNode {
  const query: OperationDefinitionNode | undefined = getQuery(document);
  if (query === undefined) {
    console.log('bad');
    process.exit(1);
  }

  const finalDocument: DocumentNode = {
    kind: document.kind,
    loc: document.loc,
    definitions: [{
      kind: query.kind,
      directives: query.directives,
      operation: query.operation,
      name: query.name,
      variableDefinitions: query.variableDefinitions,
      selectionSet: reWriteAstToSelectionSets(query, document),
    }],
  };
  return finalDocument;
}

// Pass by reference to update map, a bit gross this also makes it so all the inner
// objects get their new fields as we traverse the tree rather than having to do a second
// pass at the end
function inspectGraphQLTypeAndSelectionSet(
  allTypes: Map<string, MetaType>,
  selectionSet: SelectionSetNode,
  objectType: GraphQLObjectType,
) {
  // Hard code out queries for now
  if (objectType.name === 'Query') {
    return;
  }

  if (!allTypes.has(objectType.name)) {
    allTypes.set(objectType.name, new MetaType(objectType.name));
  }

  const objFields = objectType.getFields();
  const metaType = allTypes.get(objectType.name);
  selectionSet.selections.forEach((selection) => {
    // our re-written ast only has fields so this is a safe assumption
    if (selection.kind === 'Field') {
      const objectField = objFields[selection.name.value];
      if (objectField === undefined) {
        console.log('bad');
        process.exit(1);
      }

      let innerType = objectField.type;
      let isList = false;
      if (innerType instanceof GraphQLNonNull) {
        innerType = innerType.ofType;
        if (innerType instanceof GraphQLList) {
          innerType = innerType.ofType;
          isList = true;
        }
      } else if (innerType instanceof GraphQLList) {
        innerType = innerType.ofType instanceof GraphQLNonNull
          ? innerType.ofType.ofType : innerType.ofType;
        isList = true;
      }
      if (innerType instanceof GraphQLObjectType) {
        if (!allTypes.has(innerType.name)) {
          allTypes.set(innerType.name, new MetaType(innerType.name));
        }
      } else if (innerType instanceof GraphQLScalarType) {
        allTypes.set(innerType.name, new MetaType(innerType.name, innerType.name));
      } else if (innerType instanceof GraphQLEnumType) {
        if (!allTypes.has(innerType.name)) {
          const enumValues = innerType.getValues().map((enumValue) => enumValue.name);
          allTypes.set(innerType.name, new MetaType(innerType.name, null, enumValues));
        }
      }

      if ('name' in innerType) {
        metaType?.addFieldDef({
          fieldName: objectField.name,
          fieldType: allTypes.get(innerType.name) as MetaType,
          isList,
        });
      }
    }
  });
}

function createMetaTypesForSelections(
  graphQLSchema: GraphQLSchema,
  allDocuments: DocumentNode[],
): Map<string, MetaType> {
  // no duplicate type names can be present
  const allTypes: Map<string, MetaType> = new Map();
  const typeInfo: TypeInfo = new TypeInfo(graphQLSchema);
  allDocuments.forEach((document) => {
    visit(document, visitWithTypeInfo(typeInfo, {
      SelectionSet(node) {
        const currentType: Maybe<GraphQLOutputType> = typeInfo.getType();
        if (currentType === null || currentType === undefined) {
          return;
        }

        if (currentType instanceof GraphQLObjectType) {
          inspectGraphQLTypeAndSelectionSet(allTypes, node, currentType);
        } else if (currentType instanceof GraphQLNonNull
          && currentType.ofType instanceof GraphQLObjectType) {
          inspectGraphQLTypeAndSelectionSet(allTypes, node, currentType.ofType);
        } else if (currentType instanceof GraphQLList) {
          if (currentType.ofType instanceof GraphQLNonNull
            && currentType.ofType.ofType instanceof GraphQLObjectType) {
            inspectGraphQLTypeAndSelectionSet(allTypes, node, currentType.ofType.ofType);
          } else if (currentType.ofType instanceof GraphQLObjectType) {
            inspectGraphQLTypeAndSelectionSet(allTypes, node, currentType.ofType);
          }
        }
      },
    }));
  });

  return allTypes;
}

function reWriteType(
  metaType: MetaType,
  allTypes: Map<string, MetaType>,
) {
  const newType = new MetaType(metaType.typeName, metaType.scalarValue);
  metaType.fields.forEach((field) => {
    if (!field.fieldType.areInnerTypesResolved) {
      reWriteType(field.fieldType, allTypes);
      field.fieldType.markInnerTypesAsResolved();
    }
    newType.addFieldDef({
      fieldName: field.fieldName,
      fieldType: allTypes.get(field.fieldType.typeName) as MetaType,
      isList: field.isList,
    });
  });
  newType.markInnerTypesAsResolved();
  allTypes.set(newType.typeName, newType);
}

// More gross pass by reference
function replaceInnerTypesWithHoistedTypes(
  allTypes: Map<string, MetaType>,
) {
  allTypes.forEach((value: MetaType, _) => {
    if (!value.areInnerTypesResolved) {
      reWriteType(value, allTypes);
    }
  });
}

function generateTypeScriptTypeFile(
  allTypes: Map<string, MetaType>,
  pathForGeneratedFile: string,
) {
  let content = 'export type Maybe<T> = T | null | undefined;';
  allTypes.forEach((value: MetaType) => {
    content += `\n\n${value.generateTypeRepresentation()}`;
  });
  content += '\n';
  writeFileSync(pathForGeneratedFile, content);
}

function generate(
  pathToSchema: string,
  pathToQueries: string,
  pathForGeneratedFile: string,
) {
  const graphQLSchemaFileSource: string = readFileSync(pathToSchema).toString();
  const graphQLSchema: GraphQLSchema = buildSchema(graphQLSchemaFileSource);

  const allInputs: DocumentNode[] = parseInputQueries(pathToQueries);
  const allSelections: DocumentNode[] = allInputs.map(getQueryAndReWriteASTToSelectionSets);

  const metaTypes: Map<string, MetaType> = createMetaTypesForSelections(
    graphQLSchema,
    allSelections,
  );

  // Not needed :shrug:
  //replaceInnerTypesWithHoistedTypes(metaTypes);

  generateTypeScriptTypeFile(metaTypes, pathForGeneratedFile);
}

export default generate;
