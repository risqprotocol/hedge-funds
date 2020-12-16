# Risq Protocol

[![Build Status](https://img.shields.io/travis/risqprotocol/hedge-fund/master.svg?style=flat-square)](https://travis-ci.org/risqprotocol/hedge-fund)

Risq is blockchain software that seeks to enable participants to set up, manage and invest in technology regulated investment funds in a way that reduces barriers to entry, while minimizing the requirements for trust.

The Risq protocol is a set of rules for how digital assets can be spent once held in a Risq smart-contract, or a Risq investment fund.
These rules are meant to protect the investor and fund manager from malevolent behaviour of each other, even when both parties remain private.

### Contract addresses

For the addresses of the latest deployed contracts, check out the `deployments/latest` directory on the `master` branch.

## Install

### Prerequisites

- [node](https://www.nodejs.org)
- [yarn](https://www.yarnpkg.com)

```sh
git clone https://github.com/risqprotocol/hedge-fund.git
cd hedge-fund
yarn install
```

## Compile contracts

### Prerequisites

- [docker](https://www.docker.com/)

After installation, go to the above `protocol` directory, have Docker running, and:

```sh
make
```

## Test

After the above "Compile contracts" step, follow the instructions below, depending on if you want to run tests on your computer or on Kovan testnet.

### Local blockchain

```sh
# first terminal
yarn devchain

# in a second terminal
yarn deploy
yarn test
```

### Kovan testnet

#### Prerequisites

In order to run these tests on Kovan testnet, you'll need your own `kovan_keys.json` file with 5 public / private key pairs, each funded with some ETH. You can use `kovan_keys.json.template` to set up your accounts as follows:

1. Rename the file to `kovan_keys.json`
2. Copy/paste 5 public / private key pairs in place of `PUBLIC_KEY_1`, `PRIVATE_KEY_1`, etc
3. Send Kovan ETH to each account. For Accounts 2-5, 1 or 2 ETH per account should be fine. For account 1 with the default settings, over 200 ETH is required with the default settings, so consider the next step...
4. (optional) Adjust `deployerWethAmount` (default: 100 ETH) and `kyberReserveAmount` (default: 100 ETH) in `deploy_in_kovan.json` to smaller amounts that total less than the total Kovan ETH of Account 1. 10 ETH each should be fine.

#### Deploy and test

```sh
yarn deploy-kovan
yarn test-kovan
```

## Contribute

See [our contributing instructions](CONTRIBUTING.md).

### Security Issues

If you find a vulnerability that may affect live or testnet deployments, please send your report privately to [dev@risq.capital](mailto:dev@risq.capital). Please **DO NOT** file a public issue.
