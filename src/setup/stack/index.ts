import CloudFormation, {
  CreateStackInput,
  UpdateStackInput
} from 'aws-sdk/clients/cloudformation';
import slug from 'url-slug';
import rcfile from 'rcfile';
import chalk from 'chalk';
import ora from 'ora';

import {
  describeStack,
  logHeaders,
  getStackConfig,
  getStackInput
} from './helpers';
import confirmPrompt from '../../confirm-prompt';
import stageSelect from '../../stage-select';

const slseedrc = rcfile('slseed');
const spinner = ora();

/**
 * Checks if a current stack exists.
 *
 * @param {string} StackName The stack name to check for.
 *
 * @returns {Promise} A promise to the current stack if any.
 */
const checkIfCurrentStackExists = async (
  StackName: CloudFormation.StackName
): Promise<boolean> => {
  const cfm = new CloudFormation();

  spinner.start('Checking if CloudFormation stack exists...');

  try {
    await cfm.describeStacks({ StackName }).promise();
  } catch (err) {
    if (err.message.includes('not exist')) {
      spinner.info('Stack does not exists.');

      return false;
    }

    throw err;
  }

  return true;
};

/**
 * Creates a CloudFormation stack.
 *
 * @param {boolean} isUpdate Whether this is an update.
 * @param {object} params The create stack params.
 */
const createOrUpdateStack = async (
  isUpdate: boolean,
  params: CreateStackInput | UpdateStackInput
): Promise<void> => {
  const cfm = new CloudFormation();

  spinner.start(
    `${isUpdate ? 'Updating' : 'Creating'} CloudFormation Stack...`
  );

  if (isUpdate) {
    await cfm.updateStack({ ...params }).promise();
  } else {
    await cfm
      .createStack({ ...params, EnableTerminationProtection: true })
      .promise();
  }

  spinner.succeed(`Stack ${isUpdate ? 'update' : 'creation'} initiated...`);
};

/**
 * @param {string} StackName The stack name to check for.
 * @param {boolean} isUpdate Whether it's an update request.
 */
const checkStackStatus = async (StackName: string, isUpdate: boolean) => {
  const { StackStatus, Outputs } = await describeStack(StackName);

  switch (StackStatus) {
    case 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS':
    case 'CREATE_IN_PROGRESS':
    case 'UPDATE_IN_PROGRESS':
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait...

      return checkStackStatus(StackName, isUpdate); // Loop

    case 'CREATE_COMPLETE':
    case 'UPDATE_COMPLETE':
      spinner.succeed(
        `Stack successfully ${isUpdate ? 'updated' : 'created'}!`
      );
      console.info('Outputs:', Outputs);
      break;

    default:
      const message = [
        `Stack ${isUpdate ? 'update' : 'creation'} failed: "${StackStatus}".`,
        'Please check the AWS CloudFormation console for more information',
        '(https://console.aws.amazon.com/cloudformation/home).'
      ];

      spinner.fail(message.join(' '));
  }
};

/**
 * Validates the CloudFormation template.
 *
 * @param {string} TemplateBody The CloudFormation template body JSON.
 */
const validateTemplate = async (
  TemplateBody: CloudFormation.TemplateBody
): Promise<void> => {
  const cfm = new CloudFormation();

  spinner.start('Validating CloudFormation Stack Template...');

  await cfm.validateTemplate({ TemplateBody }).promise();

  spinner.succeed('Template body is valid.');
};

/**
 * Confirms the update.
 *
 * @returns {Promise<boolean>} A promise to the confirmation.
 */
const confirmUpdate = async (): Promise<boolean> => {
  spinner.warn('The stack already exists.');

  if (await confirmPrompt('Proceed with the update?')) {
    return true;
  }

  spinner.fail('Update canceled.');

  return false;
};

(async (): Promise<void> => {
  console.log(
    `\n${chalk.cyan.bold('Let\'s setup the CloudFormation stack...')}\n`
  );

  try {
    await stageSelect();

    const StackName = slug(
      `${slseedrc.stack} ${process.env.NODE_ENV} base stack`
    );

    logHeaders(StackName);

    if (!(await confirmPrompt('Are the above values correct?'))) {
      spinner.fail(
        'Make sure your AWS profiles and .slseedrc are configured correctly.'
      );

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

    const params = getStackInput({
      StackName,
      isUpdate,
      template,
      values: answers
    });

    await validateTemplate(params.TemplateBody);
    await createOrUpdateStack(isUpdate, params);

    spinner.info(
      'You can skip the check process if you wish by pressing [CTRL+C].'
    );
    spinner.info(
      `You should update your ".env.${process.env.NODE_ENV}" file after this.`
    );
    spinner.start(
      'Checking CloudFormation Stack status (this may take several minutes)...'
    );

    await checkStackStatus(StackName, isUpdate);

    if (await confirmPrompt('Update env file?')) {
      await import('../env');
    }
  } catch (err) {
    spinner.fail(err.message);
  }
})();
