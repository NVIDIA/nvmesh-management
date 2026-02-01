Name:				NVMesh-management
Version:			%{version}
Release:			%{release}
Summary:			"NVMesh-management" by NVIDIA

License:			Apache-2.0
URL:				http://www.nvidia.com
Source0:			%{name}

Requires:			%{requires_pkgs}

%description

Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

"NVIDIA" NVMesh-management Web App
	Branch: %{branch}
	Commit: %{commit_id}
	ChangeId: %{change_id}

%prep
cp -rf %{_sourcedir}/%{name} %{_builddir}/

%build

%pre
pidFile=/var/run/NVMesh/nvmeshmgr/management.pid
if [ -f $pidFile ] ; then
	pid=$(cat $pidFile)
	ps -ef | grep -v grep | grep -w '/opt/NVMesh/management/app.js' | grep -w $pid > /dev/null 2>&1

	if [ $? -eq 0 ] ; then
		echo "Management is up ("$pid"), please stop the service before upgrading."
		exit 1
	fi
fi

%install
mkdir -pv %{buildroot}/opt/NVMesh/management/trans-installation-scripts-%{version}-%{release}
cp -rf %{_builddir}/%{name}/install.py %{buildroot}/opt/NVMesh/management/trans-installation-scripts-%{version}-%{release}
cp -rf %{_builddir}/%{name}/upgradeScripts %{buildroot}/opt/NVMesh/management
mv %{buildroot}/opt/NVMesh/management/upgradeScripts %{buildroot}/opt/NVMesh/management/transitionUpgradeScripts

%post
upgradeScriptsDir=/opt/NVMesh/management/transitionUpgradeScripts
chmod +x $upgradeScriptsDir/*
isUpgrade=$1
hasCurrentVersion=""

if grep -i Ubuntu /etc/*release > /dev/null 2>&1; then
	if [ "$1" == "configure" ] && [ -z "$2" ]; then
	        isUpgrade=1
	elif [ "$1" == "abort-upgrade" ] || [ "$1" == "abort-remove" ]; then
		exit 0
	else
		isUpgrade=2
		hasCurrentVersion="-c $2"
	fi
fi

/opt/NVMesh/management/trans-installation-scripts-%{version}-%{release}/install.py -u $isUpgrade -s $upgradeScriptsDir -n %{version}-%{release} $hasCurrentVersion -b

%preun

%files
/opt/NVMesh/management/trans-installation-scripts-%{version}-%{release}
/opt/NVMesh/management/transitionUpgradeScripts

%changelog
* Wed Jan 1 2026 NVIDIA
- Installing NVIDIA NVMesh-management transitional package
