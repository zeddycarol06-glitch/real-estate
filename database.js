const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const rootDirectory = __dirname;
const connectionString = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/estatepro';
const migrationId = 'legacy-json-import-v1';

const createRecordModel = (name, collectionName) => {
    const schema = new mongoose.Schema({ id: { type: String, required: true, unique: true } }, {
        strict: false,
        versionKey: false,
        collection: collectionName
    });

    return mongoose.models[name] || mongoose.model(name, schema);
};

const models = {
    properties: createRecordModel('EstateProProperty', 'properties'),
    payments: createRecordModel('EstateProPayment', 'payments'),
    tenants: createRecordModel('EstateProTenant', 'tenants'),
    maintenance: createRecordModel('EstateProMaintenance', 'maintenance'),
    expenses: createRecordModel('EstateProExpense', 'expenses')
};

const settingsSchema = new mongoose.Schema({ _id: String }, {
    strict: false,
    versionKey: false,
    collection: 'settings'
});
const Settings = mongoose.models.EstateProSetting || mongoose.model('EstateProSetting', settingsSchema);

const readLegacyJson = (filename, expectedType) => {
    const filepath = path.join(rootDirectory, 'data', filename);

    if (!fs.existsSync(filepath)) {
        return null;
    }

    const parsed = JSON.parse(fs.readFileSync(filepath, 'utf8').replace(/^\uFEFF/, ''));

    if (expectedType === 'array' && !Array.isArray(parsed)) {
        throw new Error(`${filename} must contain a JSON array for the one-time MongoDB import.`);
    }

    return parsed;
};

const connectDatabase = async () => {
    await mongoose.connect(connectionString, { serverSelectionTimeoutMS: 5000 });
};

const disconnectDatabase = () => mongoose.disconnect();

const importLegacyDataOnce = async () => {
    if (await Settings.exists({ _id: migrationId })) {
        return;
    }

    const legacyCollections = [
        ['properties', 'properties.json'],
        ['payments', 'payments.json'],
        ['tenants', 'tenants.json'],
        ['maintenance', 'maintenance.json']
    ];
    const legacyRecords = legacyCollections.map(([key, filename]) => ({
        key,
        filename,
        records: readLegacyJson(filename, 'array')
    }));
    const adminRecord = readLegacyJson('admin.json', 'object');

    for (const { key, filename, records } of legacyRecords) {
        if (records?.length) {
            const operations = records.map((record) => {
                const id = String(record.id || '').trim();

                if (!id) {
                    throw new Error(`${filename} contains a record without an id; the JSON import was stopped.`);
                }

                return {
                    updateOne: {
                        filter: { id },
                        update: { $setOnInsert: { ...record, id } },
                        upsert: true
                    }
                };
            });

            await models[key].bulkWrite(operations, { ordered: true });
            console.log(`Imported ${records.length} ${key} record(s) from ${filename}.`);
        }
    }

    if (adminRecord && !await Settings.exists({ _id: 'admin' })) {
        await Settings.create({ _id: 'admin', ...adminRecord });
        console.log('Imported the administrator password record into MongoDB.');
    }

    for (const [, filename] of legacyCollections) {
        fs.rmSync(path.join(rootDirectory, 'data', filename), { force: true });
    }
    fs.rmSync(path.join(rootDirectory, 'data', 'admin.json'), { force: true });

    await Settings.create({ _id: migrationId, importedAt: new Date().toISOString() });
    console.log('Removed the migrated JSON data files.');
};

const loadApplicationData = async () => {
    await importLegacyDataOnce();

    const records = {};

    for (const [key, model] of Object.entries(models)) {
        records[key] = await model.find().lean();
    }

    const admin = await Settings.findById('admin').lean();
    if (admin) {
        delete admin._id;
    }

    return { ...records, admin: admin || null };
};

const saveCollection = async (key, records) => {
    const model = models[key];

    if (!model) {
        throw new Error(`Unknown MongoDB collection: ${key}`);
    }

    const operations = records.map((record) => ({
        replaceOne: {
            filter: { id: String(record.id) },
            replacement: record,
            upsert: true
        }
    }));

    if (operations.length) {
        await model.bulkWrite(operations, { ordered: true });
        await model.deleteMany({ id: { $nin: records.map((record) => String(record.id)) } });
    } else {
        await model.deleteMany({});
    }
};

const saveAdminRecord = async (record) => {
    await Settings.replaceOne({ _id: 'admin' }, { _id: 'admin', ...record }, { upsert: true });
};

module.exports = { connectDatabase, disconnectDatabase, loadApplicationData, saveCollection, saveAdminRecord };