module.exports = {
  cloudfront: {
    // This is the SSM param name to resolve
    ssmParam: 'public-app-cloudfront-dist-id'
  },
  s3: {
    // This is the SSM param name to resolve
    ssmParam: 'public-app-s3-bucket'
  }
};
