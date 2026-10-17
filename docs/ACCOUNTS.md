# Accounts and where things live

Notes for the team. This file holds no passwords or keys, only which account signs in where.

- **GitHub** (code and deployments, github.com/akeahms/daji-cricket): sign in with **Google**, using the account **sqinchmoney**. There is no separate GitHub password to remember.
- **Wix** (old website and the domain dajicricket.com): sign in with the Wix account for dajicricket@gmail.com. DNS records for the domain are edited in Wix, under Domains.
- **AWS / Lightsail**: the AWS root account user ID is **sqinchmoney** too (same name as the GitHub sign-in). Sign in at aws.amazon.com with that account; the password lives in the password manager.
- **Server** (AWS Lightsail, Mumbai): the website and API run here at www.dajicricket.com and api.dajicricket.com. Deploys happen automatically when a pull request is merged into `main` on GitHub.

Keep passwords and keys in a password manager, never in this file.
