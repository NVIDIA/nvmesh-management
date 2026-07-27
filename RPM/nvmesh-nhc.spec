Name:				nvmesh-nhc
Version:			%{version}
Release:			%{release}
Group:				System Environment/Kernel
Summary:			"nvmesh-nhc" by Excelero

License:			Commercial Non OSI
URL:				http://www.excelero.com
Source0:			%{name}
AutoReqProv: 			no

%global __python %{__python2.7}


%description

© Copyright 2015-2020 Excelero, Inc. All rights reserved. This document contains the confidential and proprietary information of Excelero, Inc. Do not reproduce or distribute without the prior written consent of Excelero.

"Excelero nvmesh-nhc" components.
	Branch: %{branch}
	Commit: %{commit_id}

%prep
cp -rf %{_sourcedir}/%{name} %{_builddir}/

%build

%install
mkdir -pv %{buildroot}/opt/nvmesh/nhc_files

cp -rf %{_builddir}/%{name}/nhc/nhc_files/* %{buildroot}/opt/nvmesh/nhc_files/

echo "version=\"%{version}-%{release}\"" > %{buildroot}/opt/nvmesh/nhc_files/version
echo "commit=\"%{commit_id}\"" >> %{buildroot}/opt/nvmesh/nhc_files/version
echo "branch=\"%{branch}\"" >> %{buildroot}/opt/nvmesh/nhc_files/version

%post
mkdir -p /etc/nvmesh/nvmesh_nhc_fails_cache
if [[ ! -d /etc/nhc/scripts ]]; then
    echo "There is no /etc/nhc/scripts directory, please copy /opt/nvmesh/nhc_files content to your nhc scripts directory"
else
    cp /opt/nvmesh/nhc_files/* /etc/nhc/scripts
fi

%postun
rm -rf /etc/nhc/scripts/nvmesh_*

MDIR="/opt/nvmesh/nhc_files"
if [ -d "$MDIR" ] && [ -z "$(ls -A $MDIR)" ]; then
	rm -rf $MDIR
else
	exit 0
fi

%files
/opt/nvmesh/nhc_files/

%changelog
* Wed Oct 7 2015 Excelero
- Installing Excelero nvmesh-nhc
