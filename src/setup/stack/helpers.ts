import CloudFormation, {
  CreateStackInput
} from 'aws-sdk/clients/cloudformation';
import { prompt, InputQuestion, Answers } from 'inquirer';
import { isEmpty } from '@fiquu/is/lib/presence';
import { join } from 'path';
import rcfile from 'rcfile';
import AWS from 'aws-sdk';
import chalk from 'chalk';

const slseedrc = rcfile('slseed');

interface TemplateBodyObject {
  AWSTemplateFormatVersion: string;
  Description: string;
  Resources: Record<string, string>;
  Outputs: Record<string, string>;
  Parameters: {
    Description: string;
    AllowedValues: string[];
    Default: string;
    Type: string;
  };
}

interface GetStackInputParams {
  template: TemplateBodyObject;
  StackName: string;
  isUpdate: boolean;
  values: Answers;
}

/**
 * Logs script headers.
 *
 * @param {string} StackName The stack name.
 */
export const logHeaders = (StackName: CloudFormation.StackName): void => {
  const { NODE_ENV, AWS_PROFILE } = process.env;

  console.log(`\n${chalk.bold('Stack Name:')}  ${StackName}`);
  console.log(`${chalk.bold('Node Env:')}    ${NODE_ENV}`);
  console.log(`${chalk.bold('AWS Profile:')} ${AWS_PROFILE}\n`);
};

/**
 * Creates the CloudFormation values prompts.
 *
 * @param {boolean} isUpdate Whether it is a stack update.
 * @param {object[]} values The current values.
 *
 * @returns {object[]} The CloudFormation prompt values.
 */
export const getParamsQuestions = (
  isUpdate: boolean,
  values: InputQuestion[]
): InputQuestion[] => {
  const previous = chalk.reset.dim(' (empty for previous)');

  return values.map((value: InputQuestion) => {
    const _value: InputQuestion = {
      ...value,
      default: isUpdate ? undefined : value.default,
      message: `${value.message}${isUpdate ? previous : ''}:`,
      validate: (val: string): string | boolean | Promise<string | boolean> =>
        (isUpdate && isEmpty(val)) || value.validate(val)
    };

    return _value;
  });
};

/**
 * Generates the CloudFormation template paramters.
 *
 * @param {object} params The params to use.
 *
 * @returns {object} The CloudFormation template.
 */
export const getStackInput = (params: GetStackInputParams): CreateStackInput => {
  const { StackName, isUpdate, values } = params;
  const template = { ...params.template };

  for (const key of Object.keys(values)) {
    template.Parameters[String(key)] = {
      Description: values[String(key)].message,
      Type: 'String'
    };
  }

  return {
    StackName,
    Capabilities: ['CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
    TemplateBody: JSON.stringify(template),
    Parameters: Object.keys(values).map(ParameterKey => {
      const param: AWS.CloudFormation.Parameter = { ParameterKey };

      if (isUpdate && isEmpty(values[String(ParameterKey)])) {
        param.UsePreviousValue = true;
      } else {
        param.ParameterValue = values[String(ParameterKey)];
      }

      return param;
    })
  };
};

/**
 * Describes a stack.
 *
 * @param {string} StackName The stack name.
 *
 * @returns {object} The stack object.
 */
export const describeStack = async (
  StackName: CloudFormation.StackName
): Promise<CloudFormation.Stack> => {
  const cfm = new CloudFormation();
  const { Stacks } = await cfm.describeStacks({ StackName }).promise();

  return Stacks[0];
};

/**
 * Gets the template and answers.
 *
 * @param {boolean} isUpdate Whether it is a stack update.
 */
export const getStackConfig = async (
  isUpdate: boolean
): Promise<{ template: TemplateBodyObject; answers: Answers }> => {
  // eslint-disable-next-line security/detect-non-literal-require
  const template: TemplateBodyObject = await require(join(
    slseedrc.configs,
    'stack',
    'template'
  ));
  // eslint-disable-next-line security/detect-non-literal-require
  const values: InputQuestion[] = await require(join(
    slseedrc.configs,
    'stack',
    'values'
  ));
  const questions: InputQuestion[] = getParamsQuestions(isUpdate, values);
  const answers: Answers = await prompt(questions);

  return { template, answers };
};
