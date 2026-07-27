const encryptionPropertiesConditions = 		{
	// ensure that if isEncrypted is true, a default encryption is provided
	if: { properties: { isEncrypted: { const: true } }, required: ['isEncrypted'] },
	then: { properties: { encryption: { default: { headerSize: 16 } } } }
};

module.exports = { encryptionPropertiesConditions };