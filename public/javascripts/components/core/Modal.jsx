/* global React, ReactDOM */

import Transition from './Transition.jsx';

const Modal = ({
	isOpen,
	title,
	children,
	onClose = () => {},
	centerVertically = false,
	disableBackdropClose = false,
	attachToRoot = false,
	noCloseButton = false,
	className = '',
	modalClassName = '',
	backdropClassName = ''
}) => {
	const handleBackdropClick = (e) => {
		e.stopPropagation();

		if (disableBackdropClose) {
			return;
		}

		if (e.target.classList.contains('modal')) {
			onClose();
		}
	};

	const modalContainerStyles = {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		...(centerVertically && { justifyContent: 'center' })
	};

	const modal = <Transition className="fade" on={isOpen}>
		<div className={`modal-backdrop ${backdropClassName}`}></div>
		<div className={`modal ${modalClassName}`}
		     onClick={handleBackdropClick}
		     style={modalContainerStyles}
		     role="dialog">
			<div className={`modal-dialog ${className}`}>
				<div className="modal-content">
					<div className="modal-header">
						{!noCloseButton && <button
							type="button"
							className="close"
							onClick={onClose}
							aria-label="Close"
						>
							&times;
						</button>}
						<h3 className="modal-title text-center">{title}</h3>
					</div>
					{children}
				</div>
			</div>
		</div>
	</Transition>;


	if (attachToRoot) {
		return ReactDOM.createPortal(modal, document.getElementById('modal-root'));
	}

	return modal;
};

export default Modal;
