import { prompt } from 'inquirer';
import { join } from 'path';
import rcfile from 'rcfile';
import chalk from 'chalk';
import AWS from 'aws-sdk';
import is from 'fi-is';
import ora from 'ora';

import stageSelect from '../stage-select';

const slseedrc = rcfile('slseed');
const spinner = ora();

/**
 *
 */
async function init(): Promise<void> {
  await stageSelect();

  const { AWS_PROFILE } = process.env;

  AWS.config.update({
    region: 'us-east-1',
    credentials: new AWS.SharedIniFileCredentials({
      profile: AWS_PROFILE
    })
  });
}

/**
 * Creates a simple confirm prompt message.
 *
 * @param {string} message The message to show.
 *
 * @returns {Promise} A promise to the answer.
 */
function confirmPrompt(message): Promise<any> {
  return prompt({
    name: 'confirm',
    type: 'confirm',
    default: true,
    message
  });
}

/**
 * Logs script headers.
 *
 * @param {string} StackName The stack name.
 */
function logHeaders(StackName): void {
  const { NODE_ENV, AWS_PROFILE } = process.env;

  console.log(`${chalk.bold('Stack Name:')}  ${StackName}\n`);
  console.log(`${chalk.bold('Node Env:')}    ${NODE_ENV}\n`);
  console.log(`${chalk.bold('AWS Profile:')} ${AWS_PROFILE}`);
}

/**
 * Checks if a current stack exists.
 *
 * @param {string} StackName The stack name to check for.
 *
 * @returns {Promise} A promise to the current stack if any.
 */
async function checkCurrentStack(StackName): Promise<any> {
  const cfm = new AWS.CloudFormation();

  spinner.start('Checking for current CloudFormation Stack...');

  const current = await cfm.describeStacks({ StackName }).promise();

  spinner.stop();

  return current;
}

/**
 * Normalizaes template values.
 *
 * @param {object} current The current stack.
 * @param {object[]} values The current values.
 *
 * @returns {object[]} The normalized values array.
 */
function normalizeValues(current, values): any[] {
  const previous = chalk.reset.dim(' (empty for previous)');

  return values.map(value => {
    if (current) {
      value.message += previous;
      value.default = undefined;
    }

    return value;
  });
}

/**
 * Creates the CloudFormation values prompts.
 *
 * @param {object} current The current stack reference.
 * @param {object[]} values The current values.
 *
 * @returns {object[]} The CloudFormation prompt values.
 */
function getCFMParamPrompts(current, values): any[] {
  const prompts = [];

  for (const value of normalizeValues(current, values)) {
    prompts.push({
      ...value,
      message: `${value.message}:`,
      validate: val => (current && is.empty(val)) || value.validate(val)
    });
  }

  return prompts;
}

/**
 * Generates the CloudFormation template paramters.
 *
 * @param {string} StackName The CloudFormation stack name.
 * @param {object} current The current stack reference.
 * @param {object} template The current template.
 * @param {object} values The template values.
 *
 * @returns {object} The CloudFormation template.
 */
function getTemplateParams(StackName, current, template, values): any {
  const _template = { ...template };

  for (const key of Object.keys(values)) {
    _template.Parameters[String(key)] = {
      Description: values[String(key)].message,
      Type: 'String'
    };
  }

  return {
    StackName,
    Capabilities: ['CAPABILITY_NAMED_IAM'],
    TemplateBody: JSON.stringify(_template),
    Parameters: Object.keys(values).map(ParameterKey => {
      const param: any = { ParameterKey };

      if (current && is.empty(values[String(ParameterKey)])) {
        param.UsePreviousValue = true;
      } else {
        param.ParameterValue = values[String(ParameterKey)];
      }

      return param;
    })
  };
}

/**
 * Describes a stack.
 *
 * @param {string} StackName The stack name.
 * @param {object} current The current stack reference.
 */
async function describeStacks(StackName, current): Promise<void> {
  const cfm = new AWS.CloudFormation();

  const { Stacks } = await cfm.describeStacks({ StackName }).promise();
  const { StackStatus, Outputs } = Stacks[0];

  switch (StackStatus) {
    case 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS':
    case 'CREATE_IN_PROGRESS':
    case 'UPDATE_IN_PROGRESS':
      setTimeout(() => describeStacks(StackName, current), 5000);
      break;

    case 'CREATE_COMPLETE':
    case 'UPDATE_COMPLETE':
      spinner.succeed(`Stack successfully ${current ? 'updated' : 'created'}!`);
      console.info(Outputs);
      break;

    default:
      const message = [
        `Stack ${current ? 'update' : 'creation'} failed: ${StackStatus}.`,
        'Please check the AWS CloudFormation console for more information',
        '(https://console.aws.amazon.com/cloudformation/home).'
      ];

      spinner.fail(message.join(' '));
  }
}

/**
 * Validates the CloudFormation template.
 *
 * @param {string} TemplateBody The CloudFormation template body JSON.
 */
async function validateTemplate(TemplateBody): Promise<void> {
  const cfm = new AWS.CloudFormation();

  spinner.start('Validating CloudFormation Stack Template...');

  await cfm.validateTemplate({ TemplateBody }).promise();

  spinner.succeed('Template is valid.');
}

/**
 * Creates a CloudFormation stack.
 *
 * @param {object} params The create stack params.
 */
async function createStack(params): Promise<void> {
  const cfm = new AWS.CloudFormation();

  spinner.start('Creating CloudFormation Stack...');

  await cfm.createStack({
    ...params,
    EnableTerminationProtection: true
  }).promise();

  spinner.succeed('Stack creation initiated.');
}

/**
 * Updates an existing stack.
 *
 * @param {object} params The stack update params.
 */
async function updateStack(params): Promise<void> {
  const cfm = new AWS.CloudFormation();

  spinner.start('Updating CloudFormation Stack...');

  await cfm.updateStack(params).promise();

  spinner.succeed('Stack update initiated.');
}

(async (): Promise<void> => {
  console.log(`\n${chalk.cyan.bold('Application Stack Setup Script')}\n`);

  await init();

  try {
    const StackName = `${slseedrc.stack}-${process.env.NODE_ENV}-base-stack`;

    logHeaders(StackName);

    const current = await checkCurrentStack(StackName);

    if (current) {
      spinner.warn('Template already exists.');

      if (!(await confirmPrompt('Proceed with stack update?'))) {
        spinner.info('Update canceled.');
        throw new Error('Update canceled');
      }
    }

    const template = await import(join(slseedrc.configs, 'stack', 'template'));
    const values = await import(join(slseedrc.configs, 'stack', 'values'));
    const cfmParamPrompts = getCFMParamPrompts(current, values);
    const cfmParamValues = await prompt(cfmParamPrompts);

    if (!(await confirmPrompt('Confirm values?'))) {
      spinner.warn('Values not confirmed. Canceled.');
      return;
    }

    const params = getTemplateParams(StackName, current, template, cfmParamValues);

    await validateTemplate(params.TemplateBody);

    if (current) {
      await updateStack(params);
    } else {
      await createStack(params);
    }

    spinner.info('You can skip the check process if you wish by pressing [CTRL+C].');
    spinner.start('Checking CloudFormation Stack status (this may take several minutes)...');

    await describeStacks(StackName, current);
  } catch (err) {
    spinner.fail(err.message);
    throw err;
  }
})();
