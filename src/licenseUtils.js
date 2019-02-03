const { readFileSync } = require("fs");
const { resolve } = require("path");
const glob = require("glob");
const template = require("lodash.template");
const satisfiesGlob = require("minimatch");
const { satisfies: isSatisfiedVersion } = require("semver");
const isValidLicense = require("spdx-expression-validate");
const isSatisfiedLicense = require("spdx-satisfies");
const wrap = require("wrap-ansi");
const LicenseError = require("./LicenseError");

const licenseGlob = "LICENSE*";
const licenseWrap = 80;

const getLicenseContents = dependencyPath => {
  const [licenseFilename] = glob.sync(licenseGlob, { cwd: dependencyPath, nocase: true });
  const licensePath = licenseFilename && resolve(dependencyPath, licenseFilename);
  return licensePath && wrap(readFileSync(licensePath).toString(), licenseWrap);
};

const getLicenseName = package => {
    if (package.licenses) {
        const licenseName = package.licenses.map(license => license.type).join(" OR ");
        return package.licenses.length > 1 ? `(${licenseName})` : licenseName;
    }

    return package.license;
}

const getLicenseInformationForDependency = dependencyPath => {
  const package = require(`${dependencyPath}/package.json`);
  return {
    name: package.name,
    version: package.version,
    author: (package.author && package.author.name) || package.author,
    repository: (package.repository && package.repository.url) || package.repository,
    licenseName: getLicenseName(package),
    licenseText: getLicenseContents(dependencyPath)
  };
};

const getLicenseInformationForCompilation = (compilation, filter) => {
  const fileDependencies = Array.from(compilation.fileDependencies);
  return fileDependencies.reduce((memo, dependencyPath) => {
    const match = dependencyPath.match(filter);
    if (match) {
      const [, rootPath, dependencyName] = match;
      memo[dependencyName] = getLicenseInformationForDependency(rootPath);
    }
    return memo;
  }, {});
};

const getLicenseViolations = (licenseInformation, allow) => {
  return Object.keys(licenseInformation).reduce((memo, name) => {
    const { version, licenseName } = licenseInformation[name];
    if (!licenseName || licenseName === "UNLICENSED") {
      memo.push(new LicenseError(`${name}@${version} is unlicensed`));
    } else if (!isValidLicense(licenseName) || !isSatisfiedLicense(licenseName, allow)) {
      memo.push(new LicenseError(`${name}@${version} has disallowed license ${licenseName}`));
    }
    return memo;
  }, []);
};

const getSortedLicenseInformation = licenseInformation => {
  const licenses = Object.values(licenseInformation);
  licenses.sort(({ name: nameA }, { name: nameB }) => (nameA < nameB ? -1 : nameA > nameB ? 1 : 0));
  return licenses;
};

const parseVersionExpression = expr => expr.split(/(?!^)@/);

const ignoreLicenses = (licenseInformation, ignore) => {
  return Object.keys(licenseInformation).reduce(
    (memo, dependencyName) =>
      ignore.reduce((memo, ignoredExpression) => {
        const { version: dependencyVersion } = licenseInformation[dependencyName];
        const [ignoredName, ignoredVersionRange] = parseVersionExpression(ignoredExpression);
        const matchesName = satisfiesGlob(dependencyName, ignoredName);
        const matchesVersion =
          !ignoredVersionRange || isSatisfiedVersion(dependencyVersion, ignoredVersionRange);
        if (matchesName && matchesVersion) {
          delete memo[dependencyName];
        }
        return memo;
      }, memo),
    JSON.parse(JSON.stringify(licenseInformation))
  );
};

const overrideLicenses = (licenseInformation, override) => {
  return Object.keys(licenseInformation).reduce(
    (memo, dependencyName) =>
      Object.keys(override).reduce((memo, overriddenKey) => {
        const { version: dependencyVersion } = licenseInformation[dependencyName];
        const [overriddenName, overriddenVersionRange] = parseVersionExpression(overriddenKey);
        const matchesName = dependencyName === overriddenName;
        const matchesVersion =
          !overriddenVersionRange || isSatisfiedVersion(dependencyVersion, overriddenVersionRange);
        if (matchesName && matchesVersion) {
          Object.assign(memo[dependencyName], override[overriddenKey]);
        }
        return memo;
      }, memo),
    JSON.parse(JSON.stringify(licenseInformation))
  );
};

const writeLicenseInformation = (outputWriter, dependencies) => {
  if (typeof outputWriter === "string") {
    outputWriter = template(readFileSync(outputWriter));
  }
  return outputWriter({ dependencies });
};

module.exports = {
  getLicenseInformationForCompilation,
  getLicenseViolations,
  getSortedLicenseInformation,
  ignoreLicenses,
  overrideLicenses,
  writeLicenseInformation
};
