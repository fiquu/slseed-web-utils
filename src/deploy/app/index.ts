/* eslint-disable max-lines */

import type { PutObjectRequest } from 'aws-sdk/clients/s3';
import type { PromiseResult } from 'aws-sdk/lib/request';
import type { AppDeployConfig } from './types';

import { resolve, join, extname, posix, basename } from 'path';
import { createReadStream, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import yargs, { Arguments } from 'yargs';
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

type CloudfrontUpdateResponse = Promise<
  PromiseResult<AWS.CloudFront.UpdateDistributionResult, AWS.AWSError>
>;

const specFiles = {
  gzip: [
    '.js',
    '.css',
    '.json',
    '.ico',
    '.map',
    '.xml',
    '.txt',
    '.svg',
    '.eot',
    '.ttf',
    '.woff',
    '.woff2'
  ],
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
 * Starts the build task.
 */
const rebuildDists = (): void => {
  const spawn = spawnSync('npm', ['run', 'build'], {
    stdio: 'inherit'
  });

  if (spawn.status !== 0) {
    throw spawn.error;
  }
};

/**
 * Checks if the current version has already been deployed.
 *
 * @param {string} bucket The deploy S3 bucket name.
 * @param {string} version The version to check for.
 *
 * @returns {Promise<boolean>} A promise to whether this version has been deployed.
 */
const checkIfVersionDeployed = async (
  bucket: string,
  version: string
): Promise<boolean> => {
  const s3 = new AWS.S3();

  spinner.info(`Checking deploy status for "${chalk.bold(`v${version}`)}"...`);

  const params: AWS.S3.ListObjectsRequest = {
    Prefix: `v${version}`,
    Bucket: bucket,
    MaxKeys: 1
  };

  const { Contents } = await s3.listObjects(params).promise();

  return Contents && Contents.length > 0;
};

/**
 * Lists the files to be deployed.
 *
 * @returns {string[]} The list of files to deploy.
 */
const listFilesToDeploy = (): string[] => {
  return glob.sync(`${slseedrc.dist}/**/*`, {
    nodir: true // List files only
  });
};

const getS3UploadParams = (
  file: string,
  filename: string,
  Bucket: string,
  Key: string
): PutObjectRequest => {
  const params: PutObjectRequest = {
    ContentType: mime.contentType(extname(file)) || undefined,
    CacheControl: 'max-age=86400',
    Bucket,
    Key
  };

  if (specFiles.pwa.includes(basename(filename))) {
    params.CacheControl =
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
  }

  if (specFiles.gzip.includes(extname(filename))) {
    params.Body = zlib.gzipSync(readFileSync(file), { level: 9 });
    params.ContentEncoding = 'gzip';
  } else {
    params.Body = createReadStream(file);
  }

  return params;
};

/**
 * @param {string} Bucket The bucket to deploy to.
 * @param {string} version The version to deploy.
 *
 * @returns {Promise} A promise to the file uploads.
 */
const uploadFiles = (
  Bucket: string,
  version: string
): Promise<AWS.S3.ManagedUpload.SendData[]> => {
  const files = listFilesToDeploy();
  const s3 = new AWS.S3();
  const infoText = `Please wait while the files are uploaded (${chalk.cyan(
    '%d'
  )}/${chalk.cyan.bold(files.length)})...`;
  let uploaded = 0;
  let index = 0;

  const uploads = Promise.all(
    files.map(file => {
      const filename = file.replace(slseedrc.dist, '');
      const Key = posix.join(`v${version}`, filename);

      spinner.info(`[${chalk.cyan(++index)}] ${chalk.bold(`"/${Key}"`)}...`);

      const params = getS3UploadParams(file, filename, Bucket, Key);

      return s3
        .upload(params)
        .promise()
        .then(data => {
          spinner.start(format(infoText, ++uploaded));

          return data;
        });
    })
  );

  spinner.start(format(infoText, 0));

  return uploads;
};

/**
 * Updates the CloudFront distribution config.
 *
 * @param {string} distId The distribution id.
 * @param {string} bucket The S3 bucket name.
 * @param {string} version The version to deploy
 *
 * @returns {Promise} A promise to the request.
 */
const updateDistConfig = async (
  distId: string,
  bucket: string,
  version: string
): CloudfrontUpdateResponse => {
  const cloudfront = new AWS.CloudFront();

  const distConfig = await cloudfront
    .getDistributionConfig({ Id: distId })
    .promise();

  return cloudfront
    .updateDistribution({
      Id: distId,
      IfMatch: distConfig.ETag,
      DistributionConfig: {
        ...distConfig.DistributionConfig,
        DefaultRootObject: 'index.html',
        Origins: {
          Quantity: 1,
          Items: [
            {
              ...distConfig.DistributionConfig.Origins.Items.pop(), // Copy last origin's config
              DomainName: `${bucket}.s3.amazonaws.com`,
              Id: `S3-${bucket}/v${version}`,
              OriginPath: `/v${version}`
            }
          ]
        },
        DefaultCacheBehavior: {
          ...distConfig.DistributionConfig.DefaultCacheBehavior,
          TargetOriginId: `S3-${bucket}/v${version}`
        }
      }
    })
    .promise();
};

/**
 * @param {string} distId The distribution Id.
 */
const showDistributionDomains = async (distId: string) => {
  const cloudfront = new AWS.CloudFront();
  const { Distribution } = await cloudfront
    .getDistribution({ Id: distId })
    .promise();

  spinner.info(
    `${chalk.bold('Distribution URL')}: https://${Distribution.DomainName}`
  );

  if (Distribution.DistributionConfig?.Aliases?.Items?.length > 0) {
    spinner.info(`${chalk.bold('Distribution aliases')}:`);

    Distribution.DistributionConfig.Aliases.Items.forEach(alias =>
      console.log(`  - https://${alias}`)
    );
  }
};

/**
 * Deploys the distributables to S3.
 *
 * @param {object} config The config object.
 * @param {string} bucket The deploy S3 Bucket name.
 * @param {string} version The version to deploy.
 */
const deploy = async (
  config: AppDeployConfig,
  bucket: string,
  version: string
): Promise<void> => {
  spinner.info('Uploading files from dist...');

  await uploadFiles(bucket, version);

  spinner.prefixText = '';
  spinner.succeed('All files uploaded!');
  spinner.start('Updating CloudFront distribution...');

  const distId = process.env[String(config.distId)];

  await updateDistConfig(distId, bucket, version);

  spinner.succeed('CloudFront distribution updated.');

  if (autoDeploy || (await confirmPrompt('Invalidate the distribution?'))) {
    spinner.info('Requesting invalidation...');

    await invalidateDist(distId);

    spinner.succeed('Invalidation requested!');

    if (autoDeploy || (await confirmPrompt('Prune old deployed versions?'))) {
      await prunePreviousVersions(bucket, version);
    }
  }

  await showDistributionDomains(distId);
};

(async (): Promise<void> => {
  await stageSelect();

  try {
    const { error } = dotenv.config({
      path: resolve(process.cwd(), `.env.${process.env.NODE_ENV}.local`)
    });

    if (error) {
      throw error;
    }

    const config: AppDeployConfig = await import(
      join(slseedrc.configs, 'deploy')
    );
    const bucket = process.env[String(config.bucket)];

    spinner.info(`Deploying for [${process.env.NODE_ENV}]...`);

    const { version } = slseedrc.package;
    const deployed = await checkIfVersionDeployed(bucket, version);

    if (deployed) {
      throw new Error('Version already deployed');
    }

    rebuildDists();

    spinner.info('Starting deploy process...');

    await deploy(config, bucket, version);

    spinner.succeed('Deploy complete!');
  } catch (err) {
    spinner.fail(err.message);
    process.exitCode = 1;
  }
})();
