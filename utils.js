const PhoneNumber = require('awesome-phonenumber');

exports.formatPhone = (phone, format = 'international') => {
  const phoneObject = PhoneNumber(phone);

  return phoneObject.isValid()
    ? phoneObject.getNumber(format)
    : phone;
};

exports.clearPhone = (phone) => {
  return phone.replace(/[^\d+]/gi, '').trim();
};

exports.validatePhone = (phone, format = 'international') => {
  return PhoneNumber(phone).isValid();
};

function sanitizeRegex(string) {
  return string.replace(/([+.)(\][])/g, '\\$1');
}


