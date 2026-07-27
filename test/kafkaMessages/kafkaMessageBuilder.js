
exports.KafkaMessageBuilder = class KafkaMessageBuilder {
	constructor(msg) {
		this.msg = msg;
	}

	build() {
		return this.msg;
	}
};