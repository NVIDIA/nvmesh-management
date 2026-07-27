Name:				nvmesh-management
Version:			%{version}
Release:			%{release}
Summary:			"nvmesh-management" by Nvidia

License:			Commercial Non OSI
URL:				http://www.nvidia.com
Source0:			%{name}

Requires:			%{requires}

%description

© Copyright 2025 Nvidia Corporation. All rights reserved. This document contains the confidential and proprietary information of Nvidia Corporation. Do not reproduce or distribute without the prior written consent of Nvidia.

"Excelero" nvmesh_management Web App
        Branch: %{branch}
        Commit: %{commit_id}
	ChangeId: %{change_id}


%prep
cp -rf %{_sourcedir}/%{name} %{_builddir}/

%build

%pre
# Ignore node_modules from shebang mangling.
# It fails with error on some modules due to python ambinguity
%global __brp_mangle_shebangs_exclude_from ^/opt/nvmesh/management/node_modules

%install
mkdir -pv %{buildroot}/opt/nvmesh/management/services
mkdir -pv %{buildroot}/etc/nvmesh
mkdir -pv %{buildroot}/var/log/nvmesh
mkdir -pv %{buildroot}/var/log/nvmesh/mgmtStats
mkdir -pv %{buildroot}/var/run/nvmesh/nvmeshmgr
mkdir -pv %{buildroot}/var/opt/nvmesh/backups
mkdir -pv %{buildroot}/var/opt/nvmesh/mgr
mkdir -pv %{buildroot}/lib/systemd/system
mkdir -pv %{buildroot}/usr/bin
mkdir -pv %{buildroot}/opt/nvmesh/interop-db
mv %{_builddir}/%{name}/interop-db %{buildroot}/opt/nvmesh/
cp %{_builddir}/%{name}/management.js.conf %{buildroot}/etc/nvmesh/
cp -rf %{_builddir}/%{name}/services/nvmeshmgr %{buildroot}/opt/nvmesh/management/services/
cp -rf %{_builddir}/%{name}/system.d/nvmeshmgr.service %{buildroot}/lib/systemd/system/
cp -rf %{_builddir}/%{name}/* %{buildroot}/opt/nvmesh/management
touch %{buildroot}/opt/nvmesh/management/dbVersion
mv %{buildroot}/opt/nvmesh/management/installation %{buildroot}/opt/nvmesh/management/installation-scripts-%{version}-%{release}
echo "version=\"%{version}-%{release}\"" > %{buildroot}/opt/nvmesh/management/version
echo "commit=\"%{commit_id}\"" >> %{buildroot}/opt/nvmesh/management/version
echo "changeID=\"%{change_id}\"" >> %{buildroot}/opt/nvmesh/management/version
echo "branch=\"%{branch}\"" >> %{buildroot}/opt/nvmesh/management/version
touch %{buildroot}/var/log/nvmesh/management.out

%post
isUpgrade=$1
versionRelease=""

if grep -i Ubuntu /etc/*release > /dev/null 2>&1; then
      chkconfig="update-rc.d"
      start_cmd="start 20 3 4 5"
      versionRelease="%{version}-%{release}"
      if [ "$1" == "configure" ] && [ -z "$2" ]; then
              isUpgrade=1
      elif [ "$1" == "abort-upgrade" ] || [ "$1" == "abort-remove" ]; then
              exit 0
      else
              isUpgrade=2
              hasCurrentVersion="-c $2"
              versionRelease="$2"
      fi
else
      versionRelease=`rpm -q --queryformat "%%{version}-%%{release}|" nvmesh-management | cut -d '|' -f1`
fi

echo "$versionRelease" > /opt/nvmesh/management/dbVersion

if [ $isUpgrade -eq 1 ]; then
	/opt/nvmesh/management/installation-scripts-%{version}-%{release}/install
fi

systemctl enable nvmeshmgr > /dev/null 2>&1

[ -f /var/opt/NVMesh/management-upgrade.err ] && mv /var/opt/NVMesh/management-upgrade.err /var/opt/nvmesh/
[ -f /var/opt/NVMesh/mgr/management_id ] && mv /var/opt/NVMesh/mgr/management_id /var/opt/nvmesh/mgr/
[ ! -z "$(ls -A /var/opt/NVMesh/backups 2>/dev/null)" ] && mv /var/opt/NVMesh/backups/* /var/opt/nvmesh/backups/
exit 0

%preun
/opt/nvmesh/management/installation-scripts-%{version}-%{release}/uninstall $1

%files
/opt/nvmesh
/opt/nvmesh/management
/opt/nvmesh/interop-db
/etc/nvmesh
/var/log/nvmesh
/var/run/nvmesh
/var/opt/nvmesh
/lib/systemd/system/nvmeshmgr.service
/opt/nvmesh/management/dbVersion
%ghost /var/log/nvmesh/management.out

%defattr(-,excelero,excelero,-)
/var/opt/nvmesh/backups
/var/opt/nvmesh/mgr
/var/log/nvmesh/mgmtStats
%config(noreplace) /etc/nvmesh/management.js.conf

%changelog
* Tue Mar 5 2024 Nvidia Corporation
- Installing Nvidia nvmesh_management
