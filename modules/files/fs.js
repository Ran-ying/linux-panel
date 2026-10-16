import {createFileOperations} from '../../platform/privileged/file-operations.js';
export {TEXT_LIMIT,UPLOAD_LIMIT,filePath} from '../../platform/privileged/file-operations.js';
const operations=createFileOperations();
export const {list:listFiles,read:readText,write:writeText,upload:uploadFile,create:createEntry,
  rename:renameEntry,delete:deleteEntry,chmod:chmodEntry,chown:chownEntry}=operations;
