import { spawnSync } from 'child_process';
import { join, posix } from 'path';
import rcfile from 'rcfile';
import AWS from 'aws-sdk';
import chalk from 'chalk';
import ora from 'ora';

import confirmPrompt from '../confirm-prompt';
import stageSelect from '../stage-select';

const slseedrc = rcfile('slseed');
const spinner = ora();

/**
 * Resolves the S3 bucket name from the SSM parameter.
 *
 * @param {string} name The parameter name.
 *
 * @returns {Promise<string>} A promise to the bucket name.
 */
async function getS3BucketName(name: string): Promise<string> {
  const ssm = new AWS.SSM();

  spinner.info('Resolving deploy S3 bucket name...');

  const params = {
    Name: `/${slseedrc.stack}/${process.env.NODE_ENV}/${name}`,
    WithDecryption: true
  };

  const { Parameter } = await ssm.getParameter(params).promise();

  return Parameter.Value;
}

/**
 * Resolves the CloudFront distribution Id from the SSM parameter.
 *
 * @param {string} name The parameter name.
 *
 * @returns {Promise<string>} A promise to the CloudFront distribution Id.
 */
async function getCloudFrontDistId(name: string): Promise<string> {
  const ssm = new AWS.SSM();

  spinner.info('Resolving deploy CloudFront distribution Id...');

  const params = {
    Name: `/${slseedrc.stack}/${process.env.NODE_ENV}/${name}`,
    WithDecryption: true
  };

  const { Parameter } = await ssm.getParameter(params).promise();

  return Parameter.Value;
}

/**
 * Starts the build task.
 */
function rebuildDists(): void {
  spawnSync('npm run build', [], {
    stdio: 'inherit',
    shell: true
  });
}

/**
 * Checks if the current version has already been deployed.
 *
 * @param {string} bucket The deploy S3 bucket name.
 * @param {string} version The current vesion name.
 *
 * @returns {Promise<boolean>} A promise to whether this version has been deployed.
 */
async function checkIfVersionDeployed(bucket: string, version: string): Promise<boolean> {
  const s3 = new AWS.S3();

  spinner.info(`Checking deploy status for "${chalk.bold(`v${version}`)}"...`);

  const params: AWS.S3.ListObjectsRequest = {
    Prefix: posix.join(version),
    Bucket: bucket,
    MaxKeys: 1
  };

  const { Contents } = await s3.listObjects(params).promise();

  return Contents && Contents.length > 0;
}

/**
 * Deploys the distributables to S3.
 *
 * @param {object} config The deploy config.
 * @param {string} bucket The deploy S3 bucket name.
 * @param {string} version The current version.
 */
async function deploy(config, bucket, version): Promise<void> {
  const { region } = await require(join(slseedrc.configs, 'aws'));

  const s3DeployArgs = [
    join(slseedrc.dist, '**'),
    '--profile', process.env.AWS_PROFILE,
    '--filePrefix', version,
    '--cwd', slseedrc.dist,
    '--bucket', bucket,
    '--region', region,
    '--deleteRemoved',
    '--etag',
    '--gzip'
  ];

  if (config.cloudfront && config.cloudfront.ssmParam) {
    const cloudFrontDistId = await getCloudFrontDistId(config.cloudfront.ssmParam);

    s3DeployArgs.push('--distId', cloudFrontDistId, '--invalidate');
  }

  spinner.stop();

  spawnSync('node node_modules/.bin/s3-deploy', s3DeployArgs, {
    stdio: 'inherit',
    shell: true
  });
}

(async (): Promise<void> => {
  await stageSelect();

  const config = await require(join(slseedrc.configs, 'deploy'));

  spinner.start(`Deploying for [${process.env.NODE_ENV}]...`);

  if (await confirmPrompt('Rebuild distributables?')) {
    rebuildDists();
  }

  const { version } = await require(join(slseedrc.root, 'package.json'));
  const s3BucketName = await getS3BucketName(config.s3.ssmParam);
  const deployed = await checkIfVersionDeployed(s3BucketName, version);

  if (deployed && !(await confirmPrompt('This version has already been deployed. Proceed anyway?'))) {
    spinner.fail('Deploy aborted.');
    return;
  }

  spinner.info('Starting deploy process...');

  await deploy(config, s3BucketName, version);

  spinner.succeed('Deploy complete!');
})();

