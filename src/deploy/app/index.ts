/* eslint-disable max-lines */

import { resolve, join, extname, posix, basename } from 'path';
import { PutObjectRequest } from 'aws-sdk/clients/s3';
import { createReadStream, readFileSync } from 'fs';
import { PromiseResult } from 'aws-sdk/lib/request';
import { prompt, ListQuestion } from 'inquirer';
import { spawnSync } from 'child_process';
import { format } from 'util';
import mime from 'mime-types';
import dotenv from 'dotenv';
import rcfile from 'rcfile';
import AWS from 'aws-sdk';
import chalk from 'chalk';
import glob from 'glob';
import zlib from 'zlib';
import ora from 'ora';

import confirmPrompt from '../../confirm-prompt';
import { prunePreviousVersions } from './prune';
import { invalidateDist } from './invalidation';
import stageSelect from '../../stage-select';
import { AppDeployConfig } from './types';
import yargs, { Arguments } from 'yargs';
import { getNewVersion } from './utils';

const specFiles = {
  gzip: ['.js', '.css', '.json', '.ico', '.map', '.xml', '.txt', '.svg', '.eot', '.ttf', '.woff', '.woff2'],
  pwa: ['index.html', 'service-worker.js', 'manifest.json']
};

const slseedrc = rcfile('slseed');
const spinner = ora();
const { autoDeploy }: Arguments = yargs.options({
  autoDeploy: {
    default: false,
    type: 'boolean'
  }
}).argv;

/**
 * Bumps the patch version.
 */
function bumpPatchVersion(): void {
  const spawn = spawnSync('npm', ['version', 'patch'], {
    stdio: 'inherit'
  });

  if (spawn.status !== 0) {
    throw new Error();
  }
}

/**
 * Starts the build task.
 */
function rebuildDists(): void {
  const spawn = spawnSync('npm', ['run', 'build'], {
    stdio: 'inherit'
  });

  if (spawn.status !== 0) {
    throw new Error();
  }
}

/**
 * Checks if the current version has already been deployed.
 *
 * @param {string} bucket The deploy S3 bucket name.
 * @param {string} version The version to check for.
 *
 * @returns {Promise<boolean>} A promise to whether this version has been deployed.
 */
async function checkIfVersionDeployed(bucket: string, version: string): Promise<boolean> {
  const s3 = new AWS.S3();

  spinner.info(`Checking deploy status for "${chalk.bold(`v${version}`)}"...`);

  const params: AWS.S3.ListObjectsRequest = {
    Prefix: `v${version}`,
    Bucket: bucket,
    MaxKeys: 1
  };

  const { Contents } = await s3.listObjects(params).promise();

  return Contents && Contents.length > 0;
}

/**
 * Lists the files to be deployed.
 *
 * @returns {string[]} The list of files to deploy.
 */
function listFilesToDeploy(): string[] {
  return glob.sync(`${slseedrc.dist}/**/*`, {
    nodir: true // List files only
  });
}

/**
 * @param {string} Bucket The bucket to deploy to.
 * @param {string} version The version to deploy.
 *
 * @returns {Promise} A promise to the file uploads.
 */
function uploadFiles(Bucket: string, version: string): Promise<AWS.S3.ManagedUpload.SendData[]> {
  const s3 = new AWS.S3();

  const files = listFilesToDeploy();

  const infoText = `Please wait while the files are uploaded (${chalk.cyan('%d')}/${chalk.cyan.bold(files.length)})...`;
  let uploaded = 0;
  let index = 0;

  const uploads = Promise.all(files.map(file => {
    const filename = file.replace(slseedrc.dist, '');
    const Key = posix.join(`v${version}`, filename);

    spinner.info(`[${chalk.cyan(++index)}] ${chalk.bold(`"/${Key}"`)}...`);

    const params: PutObjectRequest = {
      ContentType: mime.contentType(extname(file)) || undefined,
      CacheControl: 'max-age=86400',
      Bucket,
      Key
    };

    if (specFiles.pwa.includes(basename(filename))) {
      params.CacheControl = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
    }

    if (specFiles.gzip.includes(extname(filename))) {
      params.Body = zlib.gzipSync(readFileSync(file), { level: 9 });
      params.ContentEncoding = 'gzip';
    } else {
      params.Body = createReadStream(file);
    }

    return s3.upload(params).promise().then(data => {
      spinner.start(format(infoText, ++uploaded));

      return data;
    });
  }));

  spinner.start(format(infoText, 0));

  return uploads;
}

type CloudfrontUpdateResponse = Promise<PromiseResult<AWS.CloudFront.UpdateDistributionResult, AWS.AWSError>>;

/**
 * Updates the CloudFront distribution config.
 *
 * @param {string} distId The distribution id.
 * @param {string} bucket The S3 bucket name.
 * @param {string} version The version to deploy
 *
 * @returns {Promise} A promise to the request.
 */
async function updateDistConfig(distId: string, bucket: string, version: string): CloudfrontUpdateResponse {
  const cloudfront = new AWS.CloudFront();

  const distConfig = await cloudfront.getDistributionConfig({ Id: distId }).promise();

  return cloudfront.updateDistribution({
    Id: distId,
    IfMatch: distConfig.ETag,
    DistributionConfig: {
      ...distConfig.DistributionConfig,
      DefaultRootObject: 'index.html',
      Origins: {
        Quantity: 1,
        Items: [{
          ...distConfig.DistributionConfig.Origins.Items.pop(), // Copy last origin's config
          DomainName: `${bucket}.s3.amazonaws.com`,
          Id: `S3-${bucket}/v${version}`,
          OriginPath: `/v${version}`
        }]
      },
      DefaultCacheBehavior: {
        ...distConfig.DistributionConfig.DefaultCacheBehavior,
        TargetOriginId: `S3-${bucket}/v${version}`
      }
    }
  }).promise();
}

/**
 * @param {string} distId The distribution Id.
 */
async function showDistributionDomains(distId: string) {
  const cloudfront = new AWS.CloudFront();
  const { Distribution } = await cloudfront.getDistribution({ Id: distId }).promise();

  spinner.info(`${chalk.bold('Distribution URL')}:`);
  console.log(`\t- https://${Distribution.DomainName}`);

  if (Distribution.DistributionConfig?.Aliases?.Items?.length > 0) {
    spinner.info(`${chalk.bold('Distribution aliases')}:`);
    Distribution.DistributionConfig.Aliases.Items.forEach(alias => console.log(`\t- https://${alias}`));
  }
}

/**
 * Deploys the distributables to S3.
 *
 * @param {object} config The config object.
 * @param {string} bucket The deploy S3 Bucket name.
 * @param {string} version The version to deploy.
 */
async function deploy(config: AppDeployConfig, bucket: string, version: string): Promise<void> {
  spinner.info('Uploading files from dist...');

  await uploadFiles(bucket, version);

  spinner.prefixText = '';
  spinner.succeed('All files uploaded!');

  spinner.start('Updating CloudFront distribution...');

  const distId = process.env[String(config.distId)];

  await updateDistConfig(distId, bucket, version);

  spinner.succeed('CloudFront distribution updated.');

  if (autoDeploy || await confirmPrompt('Invalidate the distribution?')) {
    spinner.info('Requesting invalidation...');

    await invalidateDist(distId);

    spinner.succeed('Invalidation requested!');

    if (autoDeploy || await confirmPrompt('Prune old deployed versions?')) {
      await prunePreviousVersions(bucket, version);
    }
  }

  await showDistributionDomains(distId);
}

/**
 * Prompts for preparation tasks.
 *
 * @returns {string} The preparation task.
 */
async function promptPrepTasks(): Promise<string> {
  const question: ListQuestion = {
    name: 'tasks',
    type: 'list',
    message: 'Select preparation tasks:',
    choices: [{
      name: 'Bump patch version and rebuild dists.',
      value: 'version-rebuild'
    }, {
      name: 'Rebuild dists only.',
      value: 'rebuild'
    }, {
      name: 'Nothing',
      value: 'nothing'
    }]
  };

  const { tasks } = await prompt(question);

  return tasks;
}

(async (): Promise<void> => {
  await stageSelect();

  const { error } = dotenv.config({
    path: resolve(process.cwd(), `.env.${process.env.NODE_ENV}.local`)
  });

  if (error) {
    throw error;
  }

  try {
    const config: AppDeployConfig = await import(join(slseedrc.configs, 'deploy'));

    spinner.info(`Deploying for [${process.env.NODE_ENV}]...`);

    try {
      const tasks = autoDeploy ? 'rebuild' : await promptPrepTasks();

      if (tasks === 'version-rebuild') {
        bumpPatchVersion();
        rebuildDists();
      } else if (tasks === 'rebuild') {
        rebuildDists();
      }
    } catch (err) {
      throw new Error('Preparation task failed!');
    }

    const version = getNewVersion();
    const bucket = process.env[String(config.bucket)];
    const deployed = await checkIfVersionDeployed(bucket, version);

    if (deployed && (autoDeploy || !(await confirmPrompt('This version has already been deployed. Proceed anyway?')))) {
      spinner.fail('Version already deployed. Canceled.');
      return;
    }

    spinner.info('Starting deploy process...');

    await deploy(config, bucket, version);

    spinner.succeed('Deploy complete!');
  } catch (err) {
    spinner.fail(err.message);
    process.exitCode = 1;
  }
})();

