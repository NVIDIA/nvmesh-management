const express = require('express');

const consts = require('../consts');
const kafkaModule = require('../modules/kafka.js');

const router = express.Router();

router.get('/', (req, res) => {
	const renderData = {};

	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = {
		email: req.user.email,
		isAdmin: req.user.role === consts.userRoles.ADMIN
	};
	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.kafka;

	res.render('react', renderData);
});


router.get('/clusterMetadata', (req, res) => {
	kafkaModule.getClusterMetadata((err, data) => {
		res.json(data);
	});
});


module.exports = router;
