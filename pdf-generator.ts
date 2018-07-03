import {AWSError} from 'aws-sdk';
import {Response} from './response'
import * as http from 'http';
import {RequestOptions} from 'https';
import {UUID} from 'angular2-uuid';
import {APIGatewayEvent, Callback, Context, Handler} from 'aws-lambda';
import {Body, ManagedUpload, ObjectCannedACL, PutObjectRequest} from 'aws-sdk/clients/s3';
import {ReadStream} from 'fs';
import * as pdf from 'html-pdf';
import {CreateOptions, CreateResult} from 'html-pdf';
import {BAD_REQUEST, INTERNAL_SERVER_ERROR, OK} from 'http-status-codes';
import ManagedUploadOptions = ManagedUpload.ManagedUploadOptions;
import {GeneratePdfRequest} from './src/models/generate-pdf-request';

// sets root of path to lambda task root
// https://docs.aws.amazon.com/lambda/latest/dg/nodejs-create-deployment-pkg.html
process.env.PATH = `${process.env.PATH}:${process.env.LAMBDA_TASK_ROOT}`;
const pdfS3BucketName: string = `${process.env.pdfS3Bucket}-${process.env.ENV}`;

export const generatePdf = async (
    event: APIGatewayEvent, context: Context, callback: Callback
): Promise<Handler> => {
    try {
        const body: GeneratePdfRequest = JSON.parse(event.body);

        if (!body.fromUrl) {
            console.error('No fromUrl request property passed');
            callback(null, new Response(BAD_REQUEST, {message: 'No fromUrl request property passed'}));

            return
        }

        let options: RequestOptions = body.urlOptions;

        console.log('Executing request with options', options);

        const req = http.request(options, function (res) {
            let data = '';

            res.on('data', function (chunk) {
                data += chunk;
            });

            res.on('end', async () => {
                const createOptions: CreateOptions = {
                    format: 'Letter',
                    base: '...',
                    phantomPath: './phantomjs_linux-x86_64'
                };

                const stream: ReadStream = await convertToPdf(data, createOptions);
                const url = await saveFile(stream);

                callback(null, new Response(OK, {url}));

                return;
            });
        });

        req.on('error', function (error) {
            console.log('error', error);
            throw error;
        });

        req.end();
    } catch (error) {
        console.error(`Error: ${error.message}`);
        callback(null, new Response(INTERNAL_SERVER_ERROR, {message: error}));

        return;
    }
};

async function convertToPdf(
    htmlUtf8: string, createOptions: CreateOptions
): Promise<ReadStream> {
    let createResult: CreateResult = await pdf.create(htmlUtf8, createOptions);

    let readStream: ReadStream = null;

    await createResult.toStream((err: Error, stream: ReadStream) => {
        if (err) {
            throw err;
        }

        console.log('toStream success', stream, JSON.stringify(stream));

        readStream = stream;
    });

    return readStream;
}

async function saveFile(stream): Promise<string> {
    const body: Body = stream.path;
    const filename: string = `gendpdfs/some-${UUID.UUID()}.pdf`;
    const acl: ObjectCannedACL = 'public-read';

    const params: PutObjectRequest = {
        Bucket: pdfS3BucketName,
        Body: body,
        Key: filename,
        ACL: acl
    };

    const managedUploadOptions: ManagedUploadOptions = {params};
    const managedUpload: ManagedUpload = new ManagedUpload(managedUploadOptions);

    let url: string = null;

    await managedUpload.send((awsErr: AWSError, data: ManagedUpload.SendData) => {
        if (awsErr) {
            throw awsErr;
        }

        console.log('saveFile success', data, JSON.stringify(data));

        url = data.Location;
    });

    return url;
}
