import { CreateStackInput } from 'aws-sdk/clients/cloudformation';
import { prompt, InputQuestion, Answers } from 'inquirer';
import { join } from 'path';
import rcfile from 'rcfile';
import chalk from 'chalk';
import AWS from 'aws-sdk';
import is from 'fi-is';
import ora from 'ora';

import confirmPrompt from '../confirm-prompt';
import stageSelect from '../stage-select';

const slseedrc = rcfile('slseed');
const spinner = ora();

/**
 * Initializes the proper env.
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
 * Logs script headers.
 *
 * @param {string} StackName The stack name.
 */
function logHeaders(StackName: AWS.CloudFormation.StackName): void {
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
async function checkIfCurrentStackExists(StackName: AWS.CloudFormation.StackName): Promise<boolean> {
  const cfm = new AWS.CloudFormation();

  spinner.start('Checking if CloudFormation Stack exists...');

  const { Stacks } = await cfm.describeStacks({ StackName }).promise();

  if (Stacks.length === 1) {
    spinner.info('Stack exists.');
    return true;
  }

  spinner.info('Stack does not exists.');

  return false;
}

/**
 * Creates the CloudFormation values prompts.
 *
 * @param {boolean} isUpdate Whether it is a stack update.
 * @param {object[]} values The current values.
 *
 * @returns {object[]} The CloudFormation prompt values.
 */
function getParamsQuestions(isUpdate: boolean, values: InputQuestion[]): InputQuestion[] {
  const previous = chalk.reset.dim(' (empty for previous)');

  return values.map((value: InputQuestion) => {
    const _value: InputQuestion = {
      ...value,
      default: isUpdate ? undefined : value.default,
      message: `${value.message}${isUpdate ? previous : ''}:`,
      validate: (val: string): boolean => {
        return (isUpdate && is.empty(val)) || value.validate(val);
      }
    };

    return _value;
  });
}

/**
 * Generates the CloudFormation template paramters.
 *
 * @param {string} StackName The CloudFormation stack name.
 * @param {boolean} isUpdate Whether it is a stack update.
 * @param {object} template The current template.
 * @param {object} values The template values.
 *
 * @returns {object} The CloudFormation template.
 */
function getStackInput(StackName: string, isUpdate: boolean, template: any, values: Answers): CreateStackInput {
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
      const param: AWS.CloudFormation.Parameter = { ParameterKey };

      if (isUpdate && is.empty(values[String(ParameterKey)])) {
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
 * @param {boolean} isUpdate Whether it is a stack update.
 */
async function describeStacks(StackName: AWS.CloudFormation.StackName, isUpdate: boolean): Promise<void> {
  const cfm = new AWS.CloudFormation();

  const { Stacks } = await cfm.describeStacks({ StackName }).promise();
  const { StackStatus, Outputs } = Stacks[0];

  switch (StackStatus) {
    case 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS':
    case 'CREATE_IN_PROGRESS':
    case 'UPDATE_IN_PROGRESS':
      setTimeout(() => describeStacks(StackName, isUpdate), 5000);
      break;

    case 'CREATE_COMPLETE':
    case 'UPDATE_COMPLETE':
      spinner.succeed(`Stack successfully ${isUpdate ? 'updated' : 'created'}!`);
      console.info(Outputs);
      break;

    default:
      const message = [
        `Stack ${isUpdate ? 'update' : 'creation'} failed: "${StackStatus}".`,
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
async function validateTemplate(TemplateBody: AWS.CloudFormation.TemplateBody): Promise<void> {
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
async function createStack(params: CreateStackInput): Promise<void> {
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
async function updateStack(params: AWS.CloudFormation.UpdateStackInput): Promise<void> {
  const cfm = new AWS.CloudFormation();

  spinner.start('Updating CloudFormation Stack...');

  await cfm.updateStack(params).promise();

  spinner.succeed('Stack update initiated.');
}

/**
 * Gets the template and answers.
 *
 * @param {boolean} isUpdate Whether it is a stack update.
 */
async function getStackConfig(isUpdate: boolean): Promise<any> {
  const template: AWS.CloudFormation.TemplateBody = await require(join(slseedrc.configs, 'stack', 'template'));
  const values: InputQuestion[] = await require(join(slseedrc.configs, 'stack', 'values'));
  const questions: InputQuestion[] = getParamsQuestions(isUpdate, values);
  const answers: Answers = await prompt(questions);

  return { template, answers };
}

console.log(`\n${chalk.cyan.bold('Application Stack Setup Script')}\n`);

(async (): Promise<void> => {
  await init();

  try {
    const StackName = `${slseedrc.stack}-${process.env.NODE_ENV}-base-stack`;

    logHeaders(StackName);

    const isUpdate = await checkIfCurrentStackExists(StackName);

    if (isUpdate) {
      spinner.warn('Template already exists.');

      if (!(await confirmPrompt('Proceed with stack update?'))) {
        spinner.fail('Update canceled.');
        return;
      }
    }

    const { template, answers } = await getStackConfig(isUpdate);

    if (!(await confirmPrompt('Confirm values?'))) {
      spinner.warn('Values not confirmed. Canceled.');
      return;
    }

    const params = getStackInput(StackName, isUpdate, template, answers);

    await validateTemplate(params.TemplateBody);

    if (isUpdate) {
      await updateStack(params);
    } else {
      await createStack(params);
    }

    spinner.info('You can skip the check process if you wish by pressing [CTRL+C].');
    spinner.info('Also, you should update your .env after this.');

    spinner.start('Checking CloudFormation Stack status (this may take several minutes)...');

    await describeStacks(StackName, isUpdate);
  } catch (err) {
    spinner.fail(err.message);
    throw err;
  }
})();
