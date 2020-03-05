import CloudFormation, { CreateStackInput, UpdateStackInput, TemplateBody } from 'aws-sdk/clients/cloudformation';
import { prompt, InputQuestion, Answers } from 'inquirer';
import slug from 'url-slug';
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
 * Logs script headers.
 *
 * @param {string} StackName The stack name.
 */
function logHeaders(StackName: CloudFormation.StackName): void {
  const { NODE_ENV, AWS_PROFILE } = process.env;

  console.log('');
  console.log(`${chalk.bold('Stack Name:')}  ${StackName}`);
  console.log(`${chalk.bold('Node Env:')}    ${NODE_ENV}`);
  console.log(`${chalk.bold('AWS Profile:')} ${AWS_PROFILE}`);
  console.log('');
}

/**
 * Checks if a current stack exists.
 *
 * @param {string} StackName The stack name to check for.
 *
 * @returns {Promise} A promise to the current stack if any.
 */
async function checkIfCurrentStackExists(StackName: CloudFormation.StackName): Promise<boolean> {
  const cfm = new CloudFormation();

  spinner.start('Checking if CloudFormation stack exists...');

  const { Stacks } = await cfm.describeStacks({ StackName }).promise();

  if (Stacks.length === 1) {
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
async function describeStacks(StackName: CloudFormation.StackName, isUpdate: boolean): Promise<void> {
  const cfm = new CloudFormation();

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
async function validateTemplate(TemplateBody: TemplateBody): Promise<void> {
  const cfm = new CloudFormation();

  spinner.start('Validating CloudFormation Stack Template...');

  await cfm.validateTemplate({ TemplateBody }).promise();

  spinner.succeed('Template body is valid.');
}

/**
 * Creates a CloudFormation stack.
 *
 * @param {boolean} isUpdate Whether this is an update.
 * @param {object} params The create stack params.
 */
async function createOrUpdateStack(isUpdate: boolean, params: CreateStackInput | UpdateStackInput): Promise<void> {
  const cfm = new CloudFormation();

  spinner.start(`${isUpdate ? 'Updating' : 'Creating'} CloudFormation Stack...`);

  if (isUpdate) {
    await cfm.updateStack({ ...params }).promise();
  } else {
    await cfm.createStack({ ...params, EnableTerminationProtection: true }).promise();
  }

  spinner.succeed(`Stack ${isUpdate ? 'update' : 'creation'} initiated...`);
}

/**
 * Gets the template and answers.
 *
 * @param {boolean} isUpdate Whether it is a stack update.
 */
async function getStackConfig(isUpdate: boolean): Promise<any> {
  const template: TemplateBody = await require(join(slseedrc.configs, 'stack', 'template'));
  const values: InputQuestion[] = await require(join(slseedrc.configs, 'stack', 'values'));
  const questions: InputQuestion[] = getParamsQuestions(isUpdate, values);
  const answers: Answers = await prompt(questions);

  return { template, answers };
}

/**
 * Confirms the update.
 *
 * @returns {Promise<boolean>} A promise to the confirmation.
 */
async function confirmUpdate(): Promise<boolean> {
  spinner.warn('The stack already exists.');

  if (await confirmPrompt('Proceed with the update?')) {
    return true;
  }

  spinner.fail('Update canceled.');

  return false;
}

/**
 * Checks for the stack status.
 *
 * @param {string} StackName The stack name.
 * @param {boolean} isUpdate Whether it's an update.
 */
async function doStatusCheck(StackName, isUpdate): Promise<void> {
  spinner.info('You can skip the check process if you wish by pressing [CTRL+C].');
  spinner.info(`You should update your ".env.${process.env.NODE_ENV}" file after this.`);

  spinner.start('Checking CloudFormation Stack status (this may take several minutes)...');

  await describeStacks(StackName, isUpdate);
}

console.log(`\n${chalk.cyan.bold('Let\'s setup the CloudFormation stack...')}\n`);

(async (): Promise<void> => {
  try {
    await stageSelect();

    const StackName = slug(`${slseedrc.stack} ${process.env.NODE_ENV} base stack`);

    logHeaders(StackName);

    if (!(await confirmPrompt('Are the above values correct?'))) {
      spinner.fail('Make sure your AWS profiles and .slseedrc are configured correctly.');
      return;
    }

    const isUpdate = await checkIfCurrentStackExists(StackName);

    if (isUpdate && !(await confirmUpdate())) {
      return;
    }

    const { template, answers } = await getStackConfig(isUpdate);

    if (!(await confirmPrompt('Confirm values?'))) {
      spinner.fail('Values were not confirmed.');
      return;
    }

    const params = getStackInput(StackName, isUpdate, template, answers);

    await validateTemplate(params.TemplateBody);
    await createOrUpdateStack(isUpdate, params);
    await doStatusCheck(StackName, isUpdate);
  } catch (err) {
    spinner.fail(err.message);
  }
})();
