import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IResource, LambdaIntegration, MockIntegration, PassthroughBehavior, RestApi, CognitoUserPoolsAuthorizer, AuthorizationType } from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { RemovalPolicy } from 'aws-cdk-lib';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { join } from 'path';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export class AwsCdkAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const primaryKey = "itemId"
    const tableName = "items"
    const lambdaDir = "../lambdas"
    const dynamoTable = new Table(this, 'itemTable', {
      partitionKey: {
        name: primaryKey,
        type: AttributeType.STRING
      },
      tableName: tableName,

      /**
       *  The default removal policy is RETAIN, which means that cdk destroy will not attempt to delete
       * the new table, and it will remain in your account until manually deleted. By setting the policy to
       * DESTROY, cdk destroy will delete the table (even if it has data in it)
       */
      removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production code
    });
    // Cognito User Pool
    const userPool = new cognito.UserPool(this, 'TaskAppUserPool', {
      signInAliases: { username: true, email: true },
    });



    // Cognito Authorizer for API Gateway
    const auth = new CognitoUserPoolsAuthorizer(this, 'TaskAppAuthorizer', {
      cognitoUserPools: [userPool],
    });

    // Create Resource Server 79tnr8b5btdsimm071hp66m26p
    const resourceServer = new cognito.UserPoolResourceServer(this, 'ResourceServer', {
      userPool: userPool,
      identifier: 'https://api.sandpit2.com',
      userPoolResourceServerName: 'MyResourceServer',
      scopes: [
        {
          scopeName: 'read',
          scopeDescription: 'Read access',
        },
        {
          scopeName: 'write',
          scopeDescription: 'Write access',
        },
      ],
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'TaskAppUserPoolClient', {
      userPool,
      oAuth: {
        callbackUrls: [
          'https://api.sandpit2.com',
        ],
        logoutUrls: [
          'https://api.sandpit2.com',
        ],
      },
    });

    // User URL to get the IDToken https://sandpit2.auth.ap-southeast-2.amazoncognito.com/login?response_type=token&client_id=557blnqcnp0r555sv908j9d5t4&redirect_uri=https://api.sandpit2.com
    // Once id_token is copied, you can use it in API Authorization with header
    // Authorization: Bearer <ID_TOKEN>

    const nodeJsFunctionProps: NodejsFunctionProps = {
      bundling: {
        externalModules: [
          'aws-sdk', // Use the 'aws-sdk' available in the Lambda runtime
        ],
      },
      depsLockFilePath: join(__dirname, lambdaDir, 'package-lock.json'),
      environment: {
        PRIMARY_KEY: primaryKey,
        TABLE_NAME: dynamoTable.tableName,
      },
      runtime: Runtime.NODEJS_20_X,
    }

    // Create a Lambda function for each of the CRUD operations
    const getOneLambda = new NodejsFunction(this, 'getOneItemFunction', {
      entry: join(__dirname, lambdaDir, 'get-one.ts'),
      ...nodeJsFunctionProps,
    });
    const getAllLambda = new NodejsFunction(this, 'getAllItemsFunction', {
      entry: join(__dirname, lambdaDir, 'get-all.ts'),
      ...nodeJsFunctionProps,
    });
    const createOneLambda = new NodejsFunction(this, 'createItemFunction', {
      entry: join(__dirname, lambdaDir, 'create.ts'),
      ...nodeJsFunctionProps,
    });
    const updateOneLambda = new NodejsFunction(this, 'updateItemFunction', {
      entry: join(__dirname, lambdaDir, 'update-one.ts'),
      ...nodeJsFunctionProps,
    });
    const deleteOneLambda = new NodejsFunction(this, 'deleteItemFunction', {
      entry: join(__dirname, lambdaDir, 'delete-one.ts'),
      ...nodeJsFunctionProps,
    });

    // Grant the Lambda function read access to the DynamoDB table
    dynamoTable.grantReadWriteData(getAllLambda);
    dynamoTable.grantReadWriteData(getOneLambda);
    dynamoTable.grantReadWriteData(createOneLambda);
    dynamoTable.grantReadWriteData(updateOneLambda);
    dynamoTable.grantReadWriteData(deleteOneLambda);

    // Integrate the Lambda functions with the API Gateway resource
    const getAllIntegration = new LambdaIntegration(getAllLambda);
    const createOneIntegration = new LambdaIntegration(createOneLambda);
    const getOneIntegration = new LambdaIntegration(getOneLambda);
    const updateOneIntegration = new LambdaIntegration(updateOneLambda);
    const deleteOneIntegration = new LambdaIntegration(deleteOneLambda);


    // Create an API Gateway resource for each of the CRUD operations
    const api = new RestApi(this, 'itemsApi', {
      restApiName: 'Items Service'
      // In case you want to manage binary types, uncomment the following
      // binaryMediaTypes: ["*/*"],
    });

    const items = api.root.addResource('items');
    items.addMethod('GET', getAllIntegration);
    items.addMethod('POST', createOneIntegration, {
      authorizer: auth,
      authorizationType: AuthorizationType.COGNITO,
    });
    addCorsOptions(items);

    const singleItem = items.addResource('{id}');
    singleItem.addMethod('GET', getOneIntegration);
    singleItem.addMethod('PATCH', updateOneIntegration);
    singleItem.addMethod('DELETE', deleteOneIntegration);
    addCorsOptions(singleItem);
  }
}

export function addCorsOptions(apiResource: IResource) {
  apiResource.addMethod('OPTIONS', new MockIntegration({
    // In case you want to use binary media types, uncomment the following line
    // contentHandling: ContentHandling.CONVERT_TO_TEXT,
    integrationResponses: [{
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
        'method.response.header.Access-Control-Allow-Origin': "'*'",
        'method.response.header.Access-Control-Allow-Credentials': "'false'",
        'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE'",
      },
    }],
    // In case you want to use binary media types, comment out the following line
    passthroughBehavior: PassthroughBehavior.NEVER,
    requestTemplates: {
      "application/json": "{\"statusCode\": 200}"
    },
  }), {
    methodResponses: [{
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': true,
        'method.response.header.Access-Control-Allow-Methods': true,
        'method.response.header.Access-Control-Allow-Credentials': true,
        'method.response.header.Access-Control-Allow-Origin': true,
      },
    }]
  })
}
