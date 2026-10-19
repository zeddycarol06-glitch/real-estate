const readline = require('node:readline');
const { createAdminStore, isPasswordStrongEnough, describePasswordRequirement } = require('./admin-auth');
const { connectDatabase, disconnectDatabase, loadApplicationData, saveAdminRecord } = require('./database');

const promptForPassword = (question) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
    });
});

const run = async () => {
    await connectDatabase();
    const data = await loadApplicationData();
    const credentials = createAdminStore(data.admin, { persist: saveAdminRecord });
    const providedPassword = process.argv[2] || process.env.ESTATEPRO_ADMIN_PASSWORD || '';
    const isInteractive = !providedPassword;

    if (isInteractive) {
        console.log('EstatePro admin password setup');
        console.log(describePasswordRequirement());
        console.log('Note: characters are visible in the terminal. Avoid this on shared screens.\n');
    }

    const password = isInteractive
        ? (await promptForPassword('New admin password: ')).trim()
        : String(providedPassword);

    if (!isPasswordStrongEnough(password)) {
        console.error(`Password rejected. ${describePasswordRequirement()}`);
        process.exitCode = 1;
        return;
    }

    const confirmation = isInteractive
        ? (await promptForPassword('Confirm admin password: ')).trim()
        : process.env.ESTATEPRO_ADMIN_PASSWORD_CONFIRM || password;

    if (password !== confirmation) {
        console.error('Passwords do not match.');
        process.exitCode = 1;
        return;
    }

    await credentials.write(password);
    console.log('Admin password updated in MongoDB.');
    console.log('A running EstatePro server signs out existing admin sessions automatically.');
    console.log('Sign in at /admin-login.html');
};

run().catch((error) => {
    console.error(`Could not update the admin password: ${error.message}`);
    process.exitCode = 1;
}).finally(() => disconnectDatabase());
