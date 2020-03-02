/**
 * Deploy module.
 *
 * @module configs/deploy
 */

const inquirer = require('inquirer');
const mime = require('mime-types');
const AWS = require('aws-sdk');
const chalk = require('chalk');
const path = require('path');
const walk = require('walk');
const ora = require('ora');
const fs = require('fs');

const pkg = require('../package.json');

(async () => {
  await require('./stage-select')(true);

  const spinner = ora(`Deploying for [${process.env.NODE_ENV}]...`);
  const config = require('../configs/deploy');

  const cloudfront = new AWS.CloudFront();
  const ssm = new AWS.SSM();
  const s3 = new AWS.S3();

  spinner.start();

  spinner.info('Resolving target S3 bucket name...');

  const s3BucketName = await new Promise((resolve, reject) => {
    const params = {
      Name: `/${pkg.name}/${process.env.NODE_ENV}/${config.s3.ssmParam}`,
      WithDecryption: true
    };

    ssm.getParameter(params, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(data.Parameter.Value);
    });
  });

  spinner.info(`Checking deploy status for [${chalk.bold(`v${pkg.version}`)}]...`);

  const results = await new Promise((resolve, reject) => {
    const params = {
      Prefix: path.posix.join(pkg.name, pkg.version),
      Bucket: s3BucketName,
      MaxKeys: 1
    };

    s3.listObjects(params, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(data);
    });
  });

  if (results && results.Contents && results.Contents.length > 0) {
    const answers = await inquirer.prompt({
      name: 'proceed',
      type: 'confirm',
      message: `This version has already been deployed. Proceed anyway?`,
      default: false
    });

    if (!answers.proceed) {
      spinner.warn('Deploy aborted!');
      return;
    }
  }

  spinner.info(`Listing files for deployment...`);

  const files = [];

  await new Promise((resolve, reject) => {
    const walker = walk.walk(path.resolve('dist'), {});

    walker.on('file', (root, fileStats, next) => {
      files.push(path.resolve(path.join(root, fileStats.name)));
      next();
    });

    walker.on('errors', () => {
      spinner.fail(`Read file error!`);
      reject();
    });

    walker.on('end', resolve);
  });

  console.dir(files);

  for (let file of files) {
    const Key = path.posix.join(pkg.name, pkg.version, file.replace(path.posix.join(process.cwd(), 'dist'), ''));

    spinner.info(`Uploading ${chalk.bold(`${s3BucketName}/${Key}`)}...`);

    await new Promise((resolve, reject) => {
      const params = {
        ContentType: mime.contentType(path.extname(file)) || undefined,
        Body: fs.createReadStream(file),
        Bucket: s3BucketName,
        Key
      };

      s3.upload(params, err => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    });

    spinner.succeed(`Upload successful.`);
  }

  spinner.succeed(`All files uploaded!`);

  spinner.info('Resolving target CloudFront distribution ID...');

  const cloudfrontDistId = await new Promise((resolve, reject) => {
    const params = {
      Name: `/${pkg.name}/${process.env.NODE_ENV}/${config.cloudfront.ssmParam}`,
      WithDecryption: true
    };

    ssm.getParameter(params, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(data.Parameter.Value);
    });
  });

  spinner.info(`Updating CloudFront distribution...`);

  const distConfig = await new Promise((resolve, reject) => {
    const params = {
      Id: cloudfrontDistId
    };

    cloudfront.getDistributionConfig(params, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(data);
    });
  });

  await new Promise((resolve, reject) => {
    const params = {
      Id: cloudfrontDistId,
      IfMatch: distConfig.ETag,
      DistributionConfig: {
        ...distConfig.DistributionConfig,
        Comment: `${pkg.app.name} [${process.env.NODE_ENV}]`,
        DefaultRootObject: 'index.html',
        Origins: {
          Quantity: 1,
          Items: [
            {
              ...distConfig.DistributionConfig.Origins.Items.pop(), // Copy last origin's config
              Id: `S3-${s3BucketName}/${pkg.name}/${pkg.version}`,
              DomainName: `${s3BucketName}.s3.amazonaws.com`,
              OriginPath: `/${pkg.name}/${pkg.version}`
            }
          ]
        },
        DefaultCacheBehavior: {
          ...distConfig.DistributionConfig.DefaultCacheBehavior,
          TargetOriginId: `S3-${s3BucketName}/${pkg.name}/${pkg.version}`
        }
      }
    };

    cloudfront.updateDistribution(params, err => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

  spinner.succeed(`CloudFront distribution updated.`);

  await new Promise((resolve, reject) => {
    const params = {
      DistributionId: cloudfrontDistId,
      InvalidationBatch: {
        CallerReference: String(Date.now()),
        Paths: {
          Quantity: 2,
          Items: ['/service-worker.js', '/index.html']
        }
      }
    };

    spinner.info(`Invalidating objects...`);

    cloudfront.createInvalidation(params, err => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

  spinner.succeed(`CloudFront invalidation requested.`);
  spinner.succeed(`Deploy complete!`);
})();
