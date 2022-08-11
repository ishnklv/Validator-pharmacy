const validator = require('./validator');

const validatePayload = async () => {
  const report = await validator.validate({ _id: '62deadb2396752bb9f9c2d87' }, {
    type: 'object',
    required: [],
    properties: {
      _id: {
        type: 'string',
        toObjectId: true,
      }
    }
  })

  if (report.hasIssues()) {
    throw new Error(report.value);
  }

  console.log('report.value', report.value);
}

validatePayload();
