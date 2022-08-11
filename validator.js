const pharmacy = require('pharmacy');
const url = require('url');
const moment = require('moment');
const _ = require('lodash');
const {ObjectId} = require('mongodb');
const {
  formatPhone,
  clearPhone,
  validatePhone,
  sanitizeRegex,
} = require('./utils');

const emailRegex =
  /^[a-z0-9._+-]+@((\d{1,3}\.){3}\d{1,3}|[a-z0-9-]{2,}(\.[a-z0-9]{2,})*)$/i;
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* eslint-disable */
const emojiRegex =
  /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])$/;
const shortTimeRegex = /[0-2][0-9]:[0-5][0-9]/i;

module.exports = new pharmacy.Store({
  field: {
    isString() {
      return typeof this.value === 'string';
    },
    isBool() {
      return typeof this.value === 'boolean';
    },
    isNumber() {
      return typeof this.value === 'number';
    },
    isObject() {
      return typeof this.value === 'object';
    },
    isArray() {
      return Array.isArray(this.value);
    },
    isNull() {
      return this.value === null;
    },
    isUndefined() {
      return typeof this.value === 'undefined';
    },
  },
  rules: {
    equals(accept, value, field) {
      return accept === value;
    },
    notEquals(accept, value, field) {
      return accept !== value;
    },
    // Check if value has specified type.
    type(accept, value, field) {
      var result;

      if (typeof value === 'undefined') {
        return true;
      }

      switch (accept) {
        case 'object':
          result = field.isObject() || field.isNull();
          break;
        case 'array':
          result = field.isArray();
          break;
        case 'string':
          result = field.isString() || field.isNull();
          break;
        case 'objectId':
          result =
            value === null || ObjectId.isValid(value);
          break;
        case 'date':
          result =
            value === '' ||
            value === null ||
            (typeof value === 'object' &&
              value instanceof Date);
          break;
        default:
          result = typeof value === accept;
      }

      if (!result) {
        return {
          value,
          accept,
          current: typeof value,
        };
      }

      return true;
    },
    // Check if value matches the RegularExpression
    regexp(accept, value, field) {
      if (!field.isString()) {
        return true;
      }
      return accept.test(value);
    },
    // Check if properties are present in the passed object value.
    required(accept, value, field) {
      if (!accept || field.isNull()) {
        return true;
      }

      if (!field.isObject()) {
        return false;
      }

      var missed = [];
      accept.forEach((name) => {
        if (
          _.has(value, name) &&
          value[name] !== '' &&
          value[name] !== null
        ) {
          return;
        }

        missed.push({
          path: name,
          accept: true,
          current: false,
          value: undefined,
        });
      });

      return missed;
    },
    // Validate object's properties
    properties(accept, value, field) {
      if (field.isNull()) {
        return true;
      }
      if (!field.isObject()) {
        return false;
      }

      // Validate object properties.
      var out = {};
      var promises = Object.getOwnPropertyNames(accept).map(
        (name) => {
          var val;

          // TODO exit on value not owned and default not in accept.
          if (!_.has(value, name)) {
            if (
              value[name] === '' &&
              'acceptEmpty' in accept[name]
            ) {
              val = value[name];
            } else if ('default' in accept[name]) {
              if (
                typeof accept[name].default ===
                'function'
              ) {
                val = accept[name].default();
              } else {
                val = accept[name].default;
              }
            } else {
              return null;
            }
          } else {
            val = value[name];
          }

          return new field.constructor({
            store: field.store,
            path: [name],
            value: val,
            recipe: pharmacy.Recipe.to(accept[name]),
          })
            .validate()
            .then((report) => {
              out[name] = report.value;

              return report;
            });
        },
      );

      // Flatten report's issues.
      return Promise.all(promises).then((reports) => {
        var result = reports.reduce((result, report) => {
          if (report && report.hasIssues()) {
            result = result.concat(report.issues);
          }

          return result;
        }, []);

        field.report.value = out;

        return result;
      });
    },
    // Validate array items
    // GOTCHA: validation inside items doesn't work
    // if default rule is set after items in the rule
    items(accept, value, field) {
      if (!field.isArray()) {
        return false;
      }

      var out = new Array(value.length);
      var promises = value.map((value, i) => {
        return new field.constructor({
          store: field.store,
          path: [i],
          value: value,
          recipe: pharmacy.Recipe.to(accept),
        })
          .validate()
          .then((report) => {
            out[i] = report.value;
            return report;
          });
      });

      // Flatten report's issues.
      return Promise.all(promises).then((reports) => {
        var result = reports.reduce((result, report) => {
          if (report && report.hasIssues()) {
            result = result.concat(report.issues);
          }

          return result;
        }, []);

        field.report.value = out;

        return result;
      });
    },
    oneOf(accept, value, field) {
      accept = accept.slice();

      var loop = function () {
        if (!accept.length) {
          return false;
        }

        var recipe = accept.shift();
        return field
          .child(field.path.slice(), value, recipe)
          .validate()
          .then((report) => {
            if (!report.hasIssues()) {
              return true;
            }

            return loop();
          });
      };

      return loop();
    },
    pattern(accept, value, field) {
      if (field.isString()) {
        return accept.test(value);
      }
    },
    length(accept, value, field) {
      if (!field.isString() && !field.isArray()) {
        return false;
      }

      return value.length === accept;
    },
    minLength(accept, value, field) {
      if (!field.isString() && !field.isArray()) {
        return false;
      }

      if (field.isString()) {
        value = value.trim();
      }

      return value.length >= accept;
    },
    maxLength(accept, value, field) {
      if (!field.isString() && !field.isArray()) {
        return false;
      }

      if (field.isString()) {
        value = value.trim();
      }

      return value.length <= accept;
    },
    enum(accept, value, field) {
      return accept.indexOf(value) > -1 || value === null;
    },
    exclude(accept, value, field) {
      return accept.indexOf(value) < 0;
    },
    url(accept, value, field) {
      if (!field.isString()) {
        return false;
      }

      var parsed = url.parse(value);
      var props = Object.getOwnPropertyNames(accept);
      var l = props.length;
      var i = -1;

      while (++i < l) {
        let prop = props[i];
        let propAccept = accept[prop];

        if (prop in parsed === 'false') {
          return false;
        }

        if (propAccept instanceof RegExp) {
          if (!propAccept.test(parsed[prop])) {
            return false;
          }
        } else if (propAccept !== parsed[prop]) {
          return false;
        }
      }

      return true;
    },

    email(accept, value, field) {
      return emailRegex.test(value) === accept;
    },

    emailOrPhone(accept, value, field) {
      const isEmail = emailRegex.test(value);
      const isPhone = validatePhone(value);

      return isEmail || isPhone;
    },

    emoji(accept, value, field) {
      return emojiRegex.test(value) === accept;
    },

    uuid(accept, value, field) {
      if (!value || typeof value !== 'string') {
        return true;
      }

      return uuidRegex.test(value) === accept;
    },

    shortTime(accept, value, field) {
      return shortTimeRegex.test(value) === accept;
    },

    forceValue: {
      filter(accept, value, field) {
        if (accept.isEnabled) {
          value = accept.value;
        }

        return value;
      },
    },

    // Type checkers

    isString(accept, value, field) {
      return typeof value === 'string';
    },

    isBool(accept, value, field) {
      return typeof value === 'boolean';
    },

    isNumber(accept, value, field) {
      return typeof value === 'number';
    },

    isInteger(accept, value, field) {
      return (
        typeof value === 'number' &&
        Math.round(value) === value
      );
    },

    isArray(accept, value, field) {
      return Array.isArray(value);
    },

    isObjectId(accept, value, field) {
      return value === null || ObjectId.isValid(value);
    },

    isCoordsString(accept, value, field) {
      const coords = value
        .split(',')
        .map(parseFloat)
        .filter((n) => !Number.isNaN(n));

      return (
        coords.length === 2 &&
        coords[1] <= 90 &&
        coords[1] >= -90 &&
        coords[0] <= 180 &&
        coords[0] >= -180
      );
    },

    minimum(accept, value, field) {
      return accept <= value;
    },

    maximum(accept, value, field) {
      return accept >= value;
    },

    modulo(accept, value, field) {
      return value % accept === 0;
    },

    langMap(allowedLangs, value, field) {
      if (!_.isObject(value)) {
        return true;
      }

      return _.keys(value).some((lang) => {
        return _.includes(
          allowedLangs.concat('default'),
          lang,
        );
      });
    },

    langMapDefault: {
      filter(defaultLocale, value, field) {
        if (typeof value === 'object' && value.default) {
          value[defaultLocale] =
            value[defaultLocale] || value.default;
        }

        return value;
      },
    },

    langMapRequired(allowedLangs, value, field) {
      if (!_.isObject(value)) {
        return true;
      }

      return _.keys(value).reduce(
        (result, key) => result && Boolean(value[key]),
      );
    },

    bounds: {
      filter(accept, value, field) {
        if (value < accept[0]) {
          value = accept[0];
        } else if (value >= accept[1]) {
          value = accept[1];
        }

        field.value = value;
        return value;
      },
    },

    default: {
      filter(accept, value) {
        if (typeof value === 'undefined') {
          if (typeof accept === 'function') {
            return accept();
          }

          return accept;
        }

        return value;
      },
    },

    // Filters
    trim: {
      filter(accept, value, field) {
        if (field.isString()) {
          value = value.trim();
        }
        return value;
      },
    },
    toLowerCase: {
      filter(accept, value, field) {
        if (field.isString()) {
          value = value.toLowerCase();
        }
        return value;
      },
    },
    toUpperCase: {
      filter(accept, value, field) {
        if (field.isString()) {
          value = value.toUpperCase();
        }
        return value;
      },
    },
    toInteger: {
      filter(accept, value, field) {
        if (!field.isNumber()) {
          value = parseInt(value) || 0;
        }

        return value;
      },
    },
    toFloat: {
      filter(accept, value, field) {
        if (!field.isNumber()) {
          value = parseFloat(value);
        }

        return value;
      },
    },
    toFixed: {
      filter(accept, value, field) {
        if (!field.isNumber()) {
          value = parseFloat(value);
        }

        value = +value.toFixed(accept);

        return value;
      },
    },
    toBoolean: {
      filter(accept, value, field) {
        if (field.isString()) {
          switch (value.toLowerCase()) {
            case 'yes':
            case 'true':
            case 'y':
            case '1':
              value = true;
              break;
            case 'no':
            case 'false':
            case 'n':
            case '0':
              value = false;
              break;
          }
        }

        return value;
      },
    },
    isDate(accept, value, field) {
      if (value === null || value === undefined) {
        return true;
      }

      return moment(value, accept).isValid();
    },
    toDate: {
      filter(accept, value, field) {
        if (!value) {
          return value;
        }

        let offset = 0;
        if (accept && typeof accept === 'object') {
          offset = accept.offset || 0;
          accept = accept.format;
        }

        return moment(value, accept)
          .add(offset, 'hours')
          .toDate();
      },
    },
    toArray: {
      filter(accept, value, field) {
        if (field.isString()) {
          if (
            accept instanceof RegExp ||
            typeof accept === 'string'
          ) {
            value = value.split(accept);
          } else {
            value = value.split(',');
          }
        }

        field.value = value;
        return value;
      },
    },

    toRegexp: {
      filter(accept, value, field) {
        if (typeof value !== 'string') {
          return value;
        }

        if (typeof accept === 'object' && accept.fromStart) {
          return new RegExp(`^${value}`, 'i');
        } else {
          return new RegExp(value, 'i');
        }
      },
    },

    toObjectId: {
      filter(accept, value, field) {
        if (ObjectId.isValid(value)) {
          value = ObjectId(value);
        }

        field.value = value;
        return value;
      },
    },

    toE164: {
      filter(accept, value, field) {
        value = formatPhone(value, 'e164');
        field.value = value;
        return value;
      },
    },

    toCoords: {
      filter(accept, value, field) {
        return value.split(',').map(parseFloat);
      },
    },

    clearPhone: {
      filter(accept, value, field) {
        if (typeof value !== 'string') {
          return;
        }

        return clearPhone(value);
      },
    },

    clearFormField: {
      filter(accept, value, field) {
        return value.replace(/[^a-zA-Z0-9]+/g, '');
      },
    },

    uniqueItems: {
      filter(accept, value, field) {
        if (!Array.isArray(value)) {
          return value;
        }

        return _.uniq(value);
      },
    },

    replace: {
      filter(accept, value, field) {
        return value.replace(accept[0], accept[1]);
      },
    },

    sanitizeRegex: {
      filter(accept, value, field) {
        return sanitizeRegex(value);
      },
    },
  },
});
