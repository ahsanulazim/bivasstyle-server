import admin from "firebase-admin";
import dotenv from "dotenv";
dotenv.config();

const serviceAccount = {
  type: "service_account",
  project_id: "bivasstyle",
  private_key_id: "a7f8fd8208960b8b93afaed298b3f99ecf113b71",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDFBljSCwAlM+Yx\n9amX7MEmLHQEOMtlBfjHcPFI0Y/RCbVIbXN6TPOLYg0jjsaHu4ZI/5SxsLOlCJ2z\nUVPIbgIW7e0XPI6++4Jyeg4RYNl1AXzxiT3iNB2rRefQ3erE5ktyMcE/nWLNu2B4\nyxZwo8LQWHaImTntui64RvufyX4VkwhF54vQUvMj0aWrWc4fdZp5k/dOEtsVmqGL\nhAhEFoBIn8NOaNZW8B7Xr7Ku2Ks1yv+oAtciCwSuoqvpeuUExbdCxsa1sB+qPtQV\nvr3sZdEYLeTZposfIpOmw3umrj9+yobBI2fDVX3wPN99K2JEJaEnnB57wVXL4Lhd\nCNWON2+DAgMBAAECggEAK9vu18slHCMCgmqadzx3/sR0iyANfw6mQ9eLjtc/uZv8\npAPhaf9JU+Te4eR9o2eGTCfA9RFN3FYfrPRUv1Bl3K7YUYzkhfU9I7ix+wJhRh+v\nraEMipdpZ2Ana6KLCYvujZwv1bZ2cS/eGOW0uBxsWK7orB3X/Giuz8zVZMuY6ros\n87+Y42Fi12uU3Liinp5AVZlLeHYwUvvVKg3tp1VBRDTztGhkXAhQZGQgr7F7XUzh\n1E3ka8yZPRavkppgkepiZ8QOxBBB4rSBloMIM5ZtDaOsnMmGIQFP9IRzKeaTY+l2\n/+rRuTiz2gD0hzrJ5qQjDX6i2UWys+/suc01/rrxaQKBgQD2646I9lBBvGJ4aVFb\nTlXeNS9nGghDbU7kgOwCByPApZo7Dk9BUi2k/Q6RvH9Ztge4yZvVzIne+BaADasL\nRAxnz0BX39Q9N177QQP2aDTLOov1yUpMb0FPtrEsb6fQFadvuAszpCmbT/xlNl8m\nf/b8/036fJ4iCQWKsSeGqEg7vQKBgQDMRRaMNqyDc1vwl04SJLjs9slxRXjUUOOg\ncOTaMHk9ST60E+Ds6ApKUrcUR9HVVka4/oTks7LtxvkqIkiOfJH/lxFzw5vxRuk/\nTtBipIU9UInEPW/4PgG2GsZjG4zldiRs1f/fHwGKvGJDxVg1Er3VfWX7ScHd6GWQ\nSwBsZYFsPwKBgFO5f7U1P/VqOUF3BJ0fLMKR6ibdjtu+HrggduYhIaBbBrbrnTga\n81s0a1JDRjNXI7smsW6HUmCGYqq897h0NHimr7ycKs0vD0fGvd85al1W1spanJTa\nTJ0I536XxaErFoEtOK8kBO+i6YQwMYdOcKNMtlYvFzeXM4fZlft06DlJAoGAJ91b\n1yVcaZL74GpG7DeKd4R6L8b1G8plggxGPWa0YoeG2zH99X4bdAHMhQK3KsFZsATL\n/q4rP0hTnCtwqY4aGB1tZIBKUL4cCyTgej/NWPf8yvWKgpHnV5jGGtVnm+iAl1T0\nSKEOdfrp2nwLCOCNd7qvSmlMkngmShC5Fm6A4ZUCgYEAwvTQ/ZkPso6bYo36eTLA\nk9+sN/qFIXyhJa2y5lJKyENwtTgNY6JO8/0ko3o4P+ybA7pIEw0fcech2yrKjD5X\n1d9ujQ1Ngr9aydY8bVnjdz60MA6H/bhGlk5+j9n/MkBGnc2Ne7M9P027J15tDSJq\nFYmy9+y0UkGv3WwuHvrTvRA=\n-----END PRIVATE KEY-----\n",
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: "googleapis.com",
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default admin;
