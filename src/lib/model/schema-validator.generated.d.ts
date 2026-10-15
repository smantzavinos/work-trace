// Types for the generated standalone Ajv validator (see scripts/gen-validator.mjs).
export interface SchemaError {
	instancePath: string;
	schemaPath: string;
	keyword: string;
	params: Record<string, unknown>;
	message?: string;
}
export interface StandaloneValidator {
	(data: unknown): boolean;
	errors?: SchemaError[] | null;
}
export declare const validate: StandaloneValidator;
export default validate;
