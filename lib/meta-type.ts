function tryParseScalar(scalarValue: string | null): string | null {
  if (scalarValue == null) {
    return null;
  }
  switch (scalarValue) {
    case 'ID':
      return 'string';
    case 'String':
      return 'string';
    case 'Boolean':
      return 'boolean';
    case 'Int':
      return 'number';
    case 'Float':
      return 'number';
    default:
      return 'any';
  }
}

interface FieldRepresentation {
  fieldName: string,
  /* eslint-disable no-use-before-define */
  fieldType: MetaType,
  /* eslint-enable no-use-before-define */
  isList: boolean,
}

class MetaType {
  typeName: string;

  fields: Map<string, FieldRepresentation>;

  scalarValue: string | null;

  enumValues: string[] | null;

  areInnerTypesResolved: boolean;

  constructor(
    typeName: string,
    scalarValue: string | null = null,
    enumValues: string[] | null = null,
  ) {
    this.typeName = typeName;
    this.fields = new Map();
    this.scalarValue = tryParseScalar(scalarValue);
    this.areInnerTypesResolved = scalarValue != null || enumValues != null;
    this.enumValues = enumValues;
  }

  addFieldDef(field: FieldRepresentation) {
    if (this.scalarValue != null || this.enumValues != null) {
      console.log('adding field to scalar');
      process.exit(1);
    }
    this.fields.set(field.fieldName, field);
  }

  markInnerTypesAsResolved() {
    this.areInnerTypesResolved = true;
  }

  generateTypeRepresentation(): string {
    if (this.scalarValue != null) {
      return `export type ${this.typeName} = ${this.scalarValue};`;
    }
    if (this.enumValues != null) {
      let representation = `export enum ${this.typeName} {`;
      this.enumValues.forEach((value) => {
        representation += `\n  ${value},`;
      });
      representation += '\n};';
      return representation;
    }
    let representation = `export type ${this.typeName} = {`;
    this.fields.forEach((field) => {
      if (field.isList) {
        representation += `\n  ${field.fieldName}: Maybe<Array<${field.fieldType.typeName}>>;`;
      } else {
        representation += `\n  ${field.fieldName}: Maybe<${field.fieldType.typeName}>;`;
      }
    });
    representation += '\n};';
    return representation;
  }

  public toString = () : string => {
    let output = `${this.typeName}`;
    this.fields.forEach((field) => {
      output += `\n${field.fieldName} ${field.fieldType.toString()}`;
    });
    return output;
  };
}

export default MetaType;
