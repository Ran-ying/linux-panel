import Ajv from 'ajv';

/**
 * Local-only read Actions in v0.2. Output schemas describe an Action's data;
 * presentation metadata never affects permissions or execution.
 */
export class ActionEngine {
  constructor(registry) {
    this.registry = registry;
    this.ajv = new Ajv({ allErrors: true, strict: false });
    this.inputValidators = new Map();
    this.outputValidators = new Map();
  }

  #resolve(id, channel, input) {
    const action = this.registry.get(id);
    if (!action || action.exposure?.[channel] !== true) {
      throw Object.assign(new Error('Action unavailable'), { statusCode: 404 });
    }
    if (action.kind !== 'read') {
      throw Object.assign(new Error('Write actions are disabled in v0.2'), { statusCode: 403 });
    }
    let validate = this.inputValidators.get(action);
    if (!validate) {
      validate = this.ajv.compile(action.inputSchema);
      this.inputValidators.set(action, validate);
    }
    if (!validate(input)) {
      const err = new Error('Invalid input');
      err.statusCode = 400;
      err.details = validate.errors;
      throw err;
    }
    return action;
  }

  async preview(id, input = {}, channel = 'web') {
    const action = this.#resolve(id, channel, input);
    return {
      action: id, kind: action.kind,
      steps: typeof action.createPlan === 'function'
        ? await action.createPlan(input)
        : [{ description: 'No preview available' }],
      note: 'Preview is informational for this read-only v0.2 action.'
    };
  }

  async run(id, input = {}, channel = 'web') {
    const action = this.#resolve(id, channel, input);
    const result = await action.execute(input);
    if (action.outputSchema) {
      let validate = this.outputValidators.get(action);
      if (!validate) {
        validate = this.ajv.compile(action.outputSchema);
        this.outputValidators.set(action, validate);
      }
      if (!validate(result)) {
        // Internal implementation error; do not expose raw data or internals to callers.
        const err = new Error('Action returned data that failed output validation');
        err.statusCode = 500;
        err.validationErrors = validate.errors;
        throw err;
      }
    }
    return { action: id, result };
  }
}
